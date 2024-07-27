import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { NextApiHandler } from "next";
import { gql } from "urql";
import {
  FulFillOrderDocument,
  OrderConfirmWebhookPayloadFragment
} from "../../../../generated/graphql";
import { api } from "../../../lib/axios";
import { createClient } from "../../../lib/create-graphq-client";
import { saleorApp } from "../../../saleor-app";


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
          id
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

const FulfillOrder = gql`
  mutation fulFillOrder($orderId: ID!, $input: OrderFulfillInput!) {
    orderFulfill(order: $orderId, input: $input) {
      errors {
        code
        message
        field
      }
      fulfillments {
        id
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

    const { payload, authData, event } = ctx;

    console.log(`Order confirmed`, event);

    /** create shipments -> create label -> save tracking number to order
     */

    const order = payload.order;

    if (!order || !order.deliveryMethod)
      return res.status(200).json({ message: "missing delivery method" });

    const shipping_address = order.shippingAddress;
    const warehouse_addess = order.channel.warehouses[0].address;
    if (!shipping_address || !shipping_address.postalCode)
      return res.status(500).json({ message: "Missing shipping address" });

    if (!warehouse_addess || !warehouse_addess.postalCode)
      return res.status(500).json({ message: "Missing warehouse address" });

    const client = createClient(authData.saleorApiUrl, async () => ({
      token: authData.token,
    }));

    try {
      const body = {
        parcels: [
          {
            weight: 1,
            height: 10,
            width: 10,
            length: 10,
            distance_unit: "CM",
            mass_unit: "KG",
          },
        ],
        address_to: {
          name: order.userEmail,
          address1: shipping_address.streetAddress1  || "Sin direccion",
          address2: shipping_address.streetAddress2  || "Sin direccion",
          city: shipping_address.city,
          province: shipping_address.countryArea || shipping_address.city,
          country: "MX",
          zip: shipping_address.postalCode,
          reference: "Frente a tienda de abarro",
          phone: shipping_address.phone,
          contents: order.lines
            .map((line) => `${line.quantity} x ${line.productName} - ${line.variantName}`)
            .join("\n"),
        },
        address_from: {
          name: "warehouse",
          address1: warehouse_addess.streetAddress1 || "Sin direccion",
          address2: warehouse_addess.streetAddress2 || "Sin direccion",
          city: warehouse_addess.city,
          province: warehouse_addess.countryArea,
          country: warehouse_addess.country.code,
          zip: warehouse_addess.postalCode,
          phone: warehouse_addess.phone
        },
        consignment_note_class_code: "14111500",
        consignment_note_packaging_code: "1H1",
      };

      const { data: shipment } = await api.post("/v1/shipments", body).catch((err) => {
        console.log(err.response.data);
        return { data: undefined };
      });

      if (!shipment) {
        console.log('There is no shipment')
        return res.status(500).json({ message: "Shipment creation failed" });
      }

      if (!Object.keys(order.deliveryMethod ?? {}).includes("id")) {
        console.log("Missing delivery method")
        return res.status(500).json({ message: "Missing delivery method" });
      }

      const included = shipment.included as any[];
      const delivered_id = order.deliveryMethod.id;

      const rate = included
        .filter((inc: any) => inc.type === "rates")
        .find((rate: any) => {
          const saleor_id = `app:saleor.skydropx-shipping.app:${rate.attributes.service_level_code}`;
          return atob(delivered_id) === saleor_id;
        });

      if (!rate) {
        console.log("Rate not found")
        return res.status(500).json({ message: "rate not found" });
      }

      const { data: label } = await api
        .post("/v1/labels", {
          rate_id: +rate.id,
          label_format: "pdf",
        })
        .catch((err) => {
          console.log(err.response.data);
          return { data: undefined };
        });

      if (!label) {
        console.log("Label creation failed")
        return res.status(500).json({ message: "Label creation failed" });
      }

      const tracking_number = label.data.attributes.tracking_number;

      if (!tracking_number) {
        console.log("There is no tracking number")
        return res.status(500).json({ message: "There is no tracking number" });
      }

      const lines = order.lines.map((line) => {
        return {
          stocks: [{quantity: line.quantity, warehouse: order.channel.warehouses[0].id}],
          orderLineId: line.id 
        }
      })
      const fulfillment = await client.mutation(FulFillOrderDocument, {
        orderId: order.id,
        input: {
          lines: lines,
          notifyCustomer: true,
          trackingNumber: tracking_number
        },
      });

      if (fulfillment.data?.orderFulfill?.errors && fulfillment.data.orderFulfill.errors.length > 0 ) {
        console.log(fulfillment.data?.orderFulfill?.errors);
        return res.status(500).json({ message: fulfillment.data.orderFulfill.errors[0].message });
      }
      
    } catch (err) {
      console.log({ err });
    }

    console.log('Event handled')
    return res.status(200).json({ message: "event handled" });
  })(req, res);
};

export default orderConfirmedHandler;

export const config = {
  api: {
    bodyParser: false,
  },
};
