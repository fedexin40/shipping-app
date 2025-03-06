import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { NextApiHandler } from "next";
import { gql } from "urql";
import {
  FulFillOrderDocument,
  MetadataUpdateDocument,
  OrderConfirmWebhookPayloadFragment
} from "../../../../generated/graphql";
import { axiosInstance } from "../../../lib/axios";
import { createClient } from "../../../lib/create-graphq-client";
import { saleorApp } from "../../../saleor-app";

const OrderConfirmWebhookPayload = gql`
  fragment OrderConfirmWebhookPayload on OrderConfirmed {
    order {
      fulfillments {
        trackingNumber
      }
      quotation_id: metafields(keys: "quotation_id")
      userEmail
      id
      shippingAddress {
        firstName
        lastName
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
          companyName
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
    const fulfillments = order?.fulfillments
    console.log(fulfillments)
    if (!fulfillments || fulfillments?.length != 0) {
      return res.status(200).json("Shipment already created");
    }

    if (!order || !order.deliveryMethod)
      return res.status(200).json({ message: "missing delivery method" });

    const shipping_address = order.shippingAddress;
    const warehouse_address = order.channel.warehouses[0].address;
    if (!shipping_address || !shipping_address.postalCode)
      return res.status(500).json({ message: "Missing shipping address" });

    if (!warehouse_address || !warehouse_address.postalCode)
      return res.status(500).json({ message: "Missing warehouse address" });

    const client = createClient(authData.saleorApiUrl, async () => ({
      token: authData.token,
    }));

    const rate_id = atob(order.deliveryMethod.id).split(":").slice(-1)[0]
    try {
      const body = {
        shipment: {
          quotation_id: order.quotation_id.quotation_id,
          rate_id: rate_id,
          address_to: {
            country_code: "mx",
            postal_code: shipping_address.postalCode,
            area_level1: shipping_address.countryArea || '',
            area_level2: shipping_address.city || '',
            area_level3: shipping_address.streetAddress1 || '',
            street1: shipping_address.streetAddress2 || '',
            reference: "Sin refencia",
            name: `${shipping_address.firstName} ${shipping_address.lastName}`,
            company: `${shipping_address.firstName} ${shipping_address.lastName}`,
            phone: shipping_address.phone || '',
            email: payload.order?.userEmail || ''
          },
          address_from: {
            country_code: "mx",
            postal_code: warehouse_address.postalCode,
            area_level1: warehouse_address.countryArea || '',
            area_level2: warehouse_address.city || '',
            area_level3: warehouse_address.streetAddress1 || '',
            street1: warehouse_address.streetAddress2 || '',
            reference: "Sin refencia",
            name: "Proyecto",
            company: payload.order?.channel.warehouses[0].companyName || '',
            phone: warehouse_address.phone,
            email: "contacto@proyecto705.com"
          },
          consignment_note: "53102400",
          package_type: "1KG"
        }
      };
      const { data } = await axiosInstance.post("/api/v1/shipments", body)

      if (!data) {
        console.log('There is no shipment')
        return res.status(500).json({ message: "Shipment creation failed" });
      }

      let label
      let tracking_number
      let tracking_url_provider
      while (!tracking_number) {
        const url = `/api/v1/shipments/${data.data.attributes.id}`
        label = await axiosInstance.get(url)
        tracking_number = label.data.included[0].attributes.tracking_number;
        tracking_url_provider = label.data.included[0].attributes.tracking_url_provider;
      }

      const { error } = await client.mutation(MetadataUpdateDocument, {
        id: order.id,
        input: [{
          key: 'tracking_url_provider',
          value: tracking_url_provider
        }],
      });

      if (error) {
        console.log(error);
        return res.status(500).json(error);
      }

      const lines = order.lines.map((line) => {
        return {
          stocks: [{ quantity: line.quantity, warehouse: order.channel.warehouses[0].id }],
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

      if (fulfillment.data?.orderFulfill?.errors && fulfillment.data.orderFulfill.errors.length > 0) {
        console.log(fulfillment.data?.orderFulfill?.errors);
        return res.status(200).json({ message: fulfillment.data.orderFulfill.errors[0].message });
      }

    } catch (err) {
      console.log({ err });
      return res.status(500).json({ message: "event handled" });
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
