import { gql } from "urql";
import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "../../../saleor-app";
import { api } from "../../../lib/axios";


const ShippingMethodSubscription = gql`
  subscription ShippingMethods {
    event {
      ... on ShippingListMethodsForCheckout {
        checkout {
          id
          shippingAddress {
            postalCode
          }
          channel {
            id
            name
            currencyCode
            warehouses {
              address {
                postalCode
              }
            }
          }
        }
      }
    }
  }
`;

export const shippingEventsWebhook = new SaleorSyncWebhook<any>({
  name: "Shipping Methods",
  webhookPath: "/api/webhooks/shipping-events",
  event: "SHIPPING_LIST_METHODS_FOR_CHECKOUT",
  apl: saleorApp.apl,
  query: ShippingMethodSubscription,
});

export default shippingEventsWebhook.createHandler(async (req, res, ctx) => {
  const { payload, event, baseUrl, authData } = ctx;

  console.log(`shipping method request: `, payload);
  console.log({ baseUrl });

  const shipping_address = payload.checkout.shippingAddress;
  const warehouse_address = payload.checkout.channel.warehouses[0].address;

  if (!shipping_address || !shipping_address.postalCode) {
    console.log("here");
    return res.status(200).json([]);
  }

  try {
    if (!warehouse_address) {
      console.log("no channel warehouse");
      return res.status(200).json([]);
    }

    const { data } = await api
      .post("/v1/quotations", {
        zip_from: warehouse_address?.postalCode,
        zip_to: shipping_address.postalCode,
        parcel: {
          weight: "1",
          height: "1",
          width: "1",
          length: "1",
        },
        carriers: [],
      })
      .catch((err) => {
        console.log(err.response.data);
        return { data: [] };
      });

    return res.status(200).json([
      ...data.map((method: any) => ({
        id: `${method.service_level_code}`,
        provider: method.provider,
        name: method.service_level_name + '.' + method.provider,
        amount: +method.total_pricing ?? 0,
        currency: payload.checkout.channel.currencyCode ?? "USD",
        maximum_delivery_days: method.days ?? undefined,
      })),
    ]);
  } catch (err) {
    console.log(err);

    return res.status(200).json([]);
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
