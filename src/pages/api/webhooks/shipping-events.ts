import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { gql } from "urql";
import { MetadataUpdateDocument } from "../../../../generated/graphql";
import { createClient } from "../../../lib/create-graphq-client";
import { createQuotation, getQuotation } from "../../../lib/skydropx";
import { saleorApp } from "../../../saleor-app";


const ShippingMethodSubscription = gql`
  subscription ShippingMethods {
    event {
      ... on ShippingListMethodsForCheckout {
        checkout {
          id
          email
          quotation_id: metafields(keys: "quotation_id")
          postal_code: metafields(keys: "postal_code")
          area_level1: metafields(keys: "area_level1")
          area_level2: metafields(keys: "area_level2")
          area_level3: metafields(keys: "area_level3")
          shippingAddress {
            city
            cityArea
            companyName
            countryArea
            postalCode
            phone
            streetAddress1
            streetAddress2
            firstName
            lastName
          }
          channel {
            id
            name
            currencyCode
            warehouses {
              address {
                city
                cityArea
                companyName
                countryArea
                postalCode
                phone
                streetAddress1
                streetAddress2
              }
            }
          }
        }
      }
    }
  }
`;

const UpdateMetaData = gql`
  mutation MetadataUpdate($id: ID!, $input: [MetadataInput!]!)  {
    updateMetadata(id: $id, input: $input) {
      errors {
        code
        message
        field
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

  const shipping_address = payload.checkout.shippingAddress;
  const warehouse_address = payload.checkout.channel.warehouses[0].address;
  const quotation_id = payload.checkout.quotation_id.quotation_id
  const original_postalCode = payload.checkout.postal_code.postal_code
  const original_area_level1 = payload.checkout.area_level1.area_level1
  const original_area_level2 = payload.checkout.area_level2.area_level2
  const original_area_level3 = payload.checkout.area_level3.area_level3

  if (!shipping_address || !shipping_address.postalCode) {
    return res.status(200).json([]);
  }

  if (!warehouse_address) {
    console.log("no channel warehouse");
    return res.status(200).json("no channel warehouse");
  }

  if (
    quotation_id &&
    original_postalCode == shipping_address.postalCode &&
    original_area_level1 == shipping_address.countryArea &&
    original_area_level2 == shipping_address.city &&
    original_area_level3 == shipping_address.streetAddress1
  ) {
    try {
      const answer = await getQuotation(quotation_id)
      const data = answer?.data
      if (!answer?.status || answer?.status >= 400) {
        throw new Error(data.error)
      }
      const shipping = data.rates.filter((rate: any) => rate.success)
      return res.status(200).json([
        ...shipping.map((method: any) => ({
          id: method.id,
          provider: method.provider_name,
          name: method.provider_service_name + '.' + method.provider_name,
          amount: method.total ?? 0,
          currency: payload.checkout.channel.currencyCode ?? "USD",
          maximum_delivery_days: method.days ?? '1',
        }))
      ]);
    } catch (error) {
      // If the transaction fails then continues
      console.log(error)
    }
  }

  try {
    const body = {
      quotation: {
        address_from: {
          country_code: "mx",
          postal_code: warehouse_address.postalCode,
          area_level1: warehouse_address.countryArea || '',
          area_level2: warehouse_address.city || '',
          area_level3: warehouse_address.streetAddress1 || '',
          street1: warehouse_address.streetAddress2 || '',
          reference: "Sin refencia",
          name: "Proyecto",
          company: warehouse_address.companyName,
          phone: warehouse_address.phone,
          email: "contacto@proyecto705.com.mx"
        },
        address_to: {
          country_code: "mx",
          postal_code: shipping_address.postalCode,
          area_level1: shipping_address.countryArea || '',
          area_level2: shipping_address.city || '',
          area_level3: shipping_address.streetAddress2 || '',
          street1: shipping_address.streetAddress1 || '',
          reference: "Sin refencia",
          name: `${shipping_address.firstName} ${shipping_address.lastName}`,
          company: `${shipping_address.firstName} ${shipping_address.lastName}`,
          phone: shipping_address.phone || '',
          email: payload.checkout.email || ''
        },
        parcel: {
          length: 10,
          width: 10,
          height: 10,
          weight: 1
        },
        requested_carriers: ["fedex", "estafeta", "dhl"]
      }
    }

    const answer = await createQuotation(body)
    const data = answer.data
    if (answer.status >= 400) {
      throw new Error(data.error)
    }

    const shipping = data.rates.filter((rate: any) => rate.success)
    const client = createClient(authData.saleorApiUrl, async () => ({
      token: authData.token,
    }));

    const { error } = await client.mutation(MetadataUpdateDocument, {
      id: payload.checkout.id,
      input: [{
        key: 'quotation_id',
        value: data.id
      }, {
        key: 'postal_code',
        value: shipping_address.postalCode
      }, {
        key: 'area_level1',
        value: shipping_address.countryArea
      }, {
        key: 'area_level2',
        value: shipping_address.city
      }, {
        key: 'area_level3',
        value: shipping_address.streetAddress1
      }],
    });

    if (error) {
      console.log(error);
      return res.status(500).json(error);
    }

    console.log(shipping)
    return res.status(200).json([
      ...shipping.map((method: any) => ({
        id: method.id,
        provider: method.provider_name,
        name: method.provider_service_name + '.' + method.provider_name,
        amount: method.total ?? 0,
        currency: payload.checkout.channel.currencyCode ?? "USD",
        maximum_delivery_days: method.days ?? '1',
      })),
    ]);
  } catch (err) {
    console.log(err);
    return res.status(500).json(err);
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
