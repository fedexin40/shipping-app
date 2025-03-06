import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { gql } from "urql";
import { OrderCancelledWebhookPayloadFragment } from "../../../../generated/graphql";
import { saleorApp } from "../../../saleor-app";

const OrderCancelledWebhookPayload = gql`
  fragment OrderCancelledWebhookPayload on OrderCancelled {
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
      metafields
    }
  }
`;

const OrderCancelledGraphqlSubscription = gql`
  ${OrderCancelledWebhookPayload}

  subscription OrderCancelled {
    event {
      ...OrderCancelledWebhookPayload
    }
  }
`;

export const orderCancelledWebhook = new SaleorAsyncWebhook<OrderCancelledWebhookPayloadFragment>({
  name: "Order Cancelled",
  webhookPath: "api/webhooks/order-cancelled",
  event: "ORDER_CANCELLED",
  apl: saleorApp.apl,
  query: OrderCancelledGraphqlSubscription,
});

export default orderCancelledWebhook.createHandler(async (req, res, ctx) => {
  const { payload, authData } = ctx;

  console.log(`Order Cancelled`);

  /** create shipments -> create label -> save tracking number to order
   */

  const order = payload.order;

  console.log({ order });

  if (!order || !order.deliveryMethod) return;

  console.log(order.deliveryMethod);
});
