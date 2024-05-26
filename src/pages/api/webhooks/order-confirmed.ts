import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../../saleor-app";
import { gql } from "urql";
import {
  OrderConfirmWebhookPayloadFragment,
  UpdateOrderTrackingNumberDocument,
} from "../../../../generated/graphql";
import { api } from "../../../lib/axios";
import { NextApiHandler } from "next";
import { createClient } from "../../../lib/create-graphq-client";

const OrderConfirmWebhookPayload = gql`
  fragment OrderConfirmWebhookPayload on OrderConfirmed {
    order {
      userEmail
      id
      shippingAddress {
        postalCode
        streetAddress1
        streetAddress2
        phone
        city
        country {
          code
        }
        countryArea
      }
      deliveryMethod {
        ... on ShippingMethod {
          id
          name
        }
        ... on Warehouse {
          id
          name
          address {
            postalCode
            streetAddress1
            streetAddress2
            phone
            city
            country {
              code
            }
            countryArea
          }
        }
      }
      total {
        gross {
          amount
        }
        currency
      }
      channel {
        warehouses {
          address {
            postalCode
            streetAddress1
            streetAddress2
            phone
            city
            country {
              code
            }
            countryArea
          }
        }
      }
      lines {
        id
        variantName
        productName
        quantity
        totalPrice {
          gross {
            amount
          }
        }
      }
    }
  }
`;

const OrderConfirmGraphqlSubscription = gql`
  ${OrderConfirmWebhookPayload}

  subscription OrderConfirmed {
    event {
      ...OrderConfirmWebhookPayload
    }
  }
`;

const OrderUpdateTrackingNumber = gql`
  mutation UpdateOrderTrackingNumber($orderId: ID!, $trackingNumber: String!) {
    updateMetadata(id: $orderId, input: [{ key: "trackingNumber", value: $trackingNumber }]) {
      errors {
        code
        message
      }
      item {
        __typename
        ... on Order {
          id
          metafields
        }
      }
    }
  }
`;

export const orderConfirmedWebhook = new SaleorAsyncWebhook<OrderConfirmWebhookPayloadFragment>({
  name: "Order Confirmed",
  webhookPath: "api/webhooks/order-confirmed",
  event: "ORDER_CONFIRMED",
  apl: saleorApp.apl,
  query: OrderConfirmGraphqlSubscription,
});

const orderConfirmedHandler: NextApiHandler = async (req, res) => {
  let domain = new URL(process.env.NEXT_PUBLIC_SALEOR_HOST_URL || "");
  req.headers["saleor-domain"] = `${domain.host}`;
  req.headers["x-saleor-domain"] = `${domain.host}`;

  const saleorApiUrl = process.env.NEXT_PUBLIC_SALEOR_HOST_URL + "/graphql/";
  req.headers["saleor-api-url"] = saleorApiUrl;

  return orderConfirmedWebhook.createHandler(async (req, res, ctx) => {
    console.log("webhook received");
    console.log(req.body);

    const { payload, authData, event } = ctx;

    console.log(`Order confirmed`, event);

    /** create shipments -> create label -> save tracking number to order
     */

    const order = payload.order;

    console.log({ order });

    if (!order || !order.deliveryMethod)
      return res.status(200).json({ message: "missing delivery method" });

    const shipping_address = order.shippingAddress;
    const warehouse_addess = order.channel.warehouses[0].address;
    if (!shipping_address || !shipping_address.postalCode)
      return res.status(200).json({ message: "Missing shipping address" });

    if (!warehouse_addess || !warehouse_addess.postalCode)
      return res.status(200).json({ message: "Missing warehouse address" });

    const client = createClient(authData.saleorApiUrl, async () => ({
      token: authData.token,
    }));

    try {
      const body = {
        parcels: [
          {
            weight: 1,
            height: 1,
            width: 1,
            length: 1,
            distance_unit: "CM",
            mass_unit: "KG",
          },
        ],
        address_to: {
          name: order.userEmail,
          address1: shipping_address.streetAddress1,
          city: shipping_address.city,
          province: shipping_address.countryArea || shipping_address.city,
          country: "MX",
          zip: shipping_address.postalCode,
          reference: "Frente a tienda de abarro",
          contents: order.lines
            .map((line) => `${line.quantity} x ${line.productName} - ${line.variantName}`)
            .join("\n"),
        },
        address_from: {
          name: "warehouse",
          address1: warehouse_addess.streetAddress1,
          city: warehouse_addess.city,
          province: warehouse_addess.countryArea,
          country: warehouse_addess.country.code,
          zip: warehouse_addess.postalCode,
        },
        consignment_note_class_code: "14111500",
        consignment_note_packaging_code: "1H1",
      };

      console.log(JSON.stringify(body, null, 2));
      const { data: shipment } = await api.post("/v1/shipments", body).catch((err) => {
        console.log(err.response.data);
        return { data: undefined };
      });

      if (!shipment) return res.status(200).json({ message: "shipment creation failed" });

      // console.log(shipment.included);

      if (!Object.keys(order.deliveryMethod ?? {}).includes("id"))
        return res.status(200).json({ message: "missing delivery method" });

      const included = shipment.included as any[];
      const delivered_id = order.deliveryMethod.id;

      const rate = included
        .filter((inc: any) => inc.type === "rates")
        .find((rate: any) => {
          console.log(rate);
          const saleor_id = `app:saleor.skydropx-shipping.app:${rate.attributes.service_level_code}`;
          return atob(delivered_id) === saleor_id;
        });

      console.log(rate);

      if (!rate) return res.status(200).json({ message: "rate not found" });

      const { data: label } = await api
        .post("/v1/labels", {
          rate_id: +rate.id,
          label_format: "pdf",
        })
        .catch((err) => {
          console.log(err.response.data);
          return { data: undefined };
        });

      if (!label) return res.status(200).json({ message: "label creation failed" });

      console.log(label);

      const tracking_number = label.data.attributes.tracking_number;

      // save tracking number to order
      const { data: updated_order } = await api
        .patch(`/v1/orders/${order.id}`, {
          tracking_number,
        })
        .catch((err) => {
          console.log(err.response.data);
          return { data: undefined };
        });

      const fulfillment = await client.query(UpdateOrderTrackingNumberDocument, {
        orderId: order.id,
        trackingNumber: tracking_number,
      });

      if (fulfillment.data?.updateMetadata?.errors) {
        console.log(fulfillment.data.updateMetadata.errors);
        return res.status(200).json({ message: fulfillment.data.updateMetadata.errors[0].message });
      }

      if (fulfillment.data?.updateMetadata?.item) {
        console.log(fulfillment.data.updateMetadata.item);
        return res.status(200).json({ message: "tracking number saved" });
      }
    } catch (err) {
      console.log({ err });
    }

    return res.status(200).json({ message: "event handled" });
  })(req, res);
};

export default orderConfirmedHandler;

export const config = {
  api: {
    bodyParser: false,
  },
};
