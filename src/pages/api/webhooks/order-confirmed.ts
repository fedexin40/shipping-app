import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { NextApiHandler } from "next";
import { gql } from "urql";
import {
  FulFillOrderDocument,
  MetadataUpdateDocument,
  OrderConfirmWebhookPayloadFragment
} from "../../../../generated/graphql";
import { createClient } from "../../../lib/create-graphq-client";
import { createQuotation, createShipping } from "../../../lib/skydropx";
import { saleorApp } from "../../../saleor-app";

const OrderConfirmWebhookPayload = gql`
  fragment OrderConfirmWebhookPayload on OrderConfirmed {
    order {
      fulfillments {
        trackingNumber
      }
      quotation_id: metafields(keys: "quotation_id")
      postal_code: metafields(keys: "postal_code")
      area_level1: metafields(keys: "area_level1")
      area_level2: metafields(keys: "area_level2")
      area_level3: metafields(keys: "area_level3")
      shipping_cost : metafields(keys: "shipping_cost")
      carrier_name : metafields(keys: "carrier_name")
      userEmail
      id
      shippingAddress {
        firstName
        lastName
        countryArea
        streetAddress1
        phone
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

    if (!warehouse_address || !warehouse_address.postalCode)
      return res.status(500).json({ message: "Missing warehouse address" });

    const client = createClient(authData.saleorApiUrl, async () => ({
      token: authData.token,
    }));

    const address_to = {
      country_code: "mx",
      postal_code: order.postal_code.postal_code,
      area_level1: order.area_level1.area_level1,
      area_level2: order.area_level2.area_level2,
      area_level3: order.area_level3.area_level3,
      street1: shipping_address?.streetAddress1 || '',
      reference: "Sin refencia",
      name: `${shipping_address?.firstName} ${shipping_address?.lastName}`.substring(0, 29),
      phone: shipping_address?.phone?.replace("+52", "") || '',
      email: payload.order?.userEmail || ''
    }
    const address_from = {
      country_code: "mx",
      postal_code: warehouse_address.postalCode,
      area_level1: warehouse_address.countryArea || '',
      area_level2: warehouse_address.city || '',
      area_level3: warehouse_address.streetAddress1 || '',
      street1: "S/N",
      reference: "Sin refencia",
      company: payload.order?.channel.warehouses[0].companyName.substring(0, 29) || '',
      name: payload.order?.channel.warehouses[0].companyName.substring(0, 29) || '',
      phone: warehouse_address.phone?.replace("+52", ""),
      email: "contacto@proyecto705.com.mx"
    }

    const rate_id = atob(order.deliveryMethod.id).split(":").slice(-1)[0]
    try {
      const body = {
        shipment: {
          quotation_id: order.quotation_id.quoation_id,
          rate_id: rate_id,
          address_to: address_to,
          address_from: address_from,
          consignment_note: "53102400",
          package_type: "4G"
        }
      }
      let answer
      let data
      let answerShipping: any
      console.log('Try to create the shipment ')
      answer = await createShipping(body).catch(async function (error) {
        // Below part is because Skydropx quotations
        // only lives for 24 hours, but there are payments like Oxxo
        // that can be take more than that, so if the quotation is not longer available
        // then create again a quotation and take the one from the same carrier and
        // closer price
        if (error.response && error.response?.status == 422) {
          console.log('The shipment creation failed because the quotation is not longer available')
          const body = {
            quotation: {
              address_from: address_from,
              address_to: address_to,
              parcel: {
                length: 10,
                width: 10,
                height: 10,
                weight: 1
              },
              requested_carriers: ["fedex", "estafeta", "dhl", "ups"]
            }
          }
          console.log('Create another quotation')
          const answer = await createQuotation(body)
          if (answer.status >= 400) {
            throw new Error(answer.data.error)
          }
          const quotation_id = answer.data.id
          const carrier_name = order.carrier_name.carrier_name
          const shipping_cost = order.shipping_cost.shipping_cost
          let difference = 99999
          let rate_id
          let shipping = answer.data.rates.filter((rate: any) => rate.success && rate.provider_name == carrier_name)
          for (let i = 0; i < shipping.length; i++) {
            const diff = Math.abs(Math.floor(shipping_cost) - shipping[i].total)
            if (diff < difference) {
              rate_id = shipping[i].id
              difference = diff
            }
          }
          const bodyShipment = {
            shipment: {
              quotation_id: quotation_id,
              rate_id: rate_id,
              address_to: address_to,
              address_from: address_from,
              consignment_note: "53102400",
              package_type: "1KG"
            }
          }
          console.log('Try to create again the shipment')
          answerShipping = await createShipping(bodyShipment)
          if (answerShipping && answerShipping?.status >= 400) {
            throw new Error(answerShipping.data.error)
          }
        }
        else {
          throw new Error(error.message)
        }
      })
      console.log('Shipment created')
      data = answer?.data || answerShipping?.data

      if (!data) {
        console.log('There is no shipment')
        return res.status(500).json({ message: "Shipment creation failed" });
      }

      const tracking_number = data.included[0].attributes.tracking_number;
      const tracking_url_provider = data.included[0].attributes.tracking_url_provider;

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
      return res.status(500).json({ message: err });
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
