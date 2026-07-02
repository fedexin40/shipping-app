import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { gql } from "urql";

import { createClient } from "../../../lib/create-graphq-client";
import { saleorApp } from "../../../saleor-app";
import { ClearShippingMetadataDocument } from "../../../../generated/graphql";
import { MetadataUpdateDocument } from "../../../../generated/graphql";
import { DeliveryOptionsCalculateDocument } from "../../../../generated/graphql";

const FREE_SHIPPING_AMOUNT = Number(process.env.free_shipping_amount ?? 1500);

const DeliveryOptionsCalculate = gql`
  mutation DeliveryOptionsCalculate($id: ID!) {
    deliveryOptionsCalculate(id: $id) {
      deliveries {
        id
        shippingMethod {
          id
          name
          active
          price {
            amount
            currency
          }
        }
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

const CheckoutUpdatedSubscription = gql`
  subscription CheckoutUpdated {
    event {
      ... on CheckoutUpdated {
        checkout {
          id

          subtotalPrice {
            gross {
              amount
              currency
            }
          }

          totalBalance {
            amount
            currency
          }

          free_shipping: metafields(keys: "free_shipping")

          deliveryMethod {
            ... on ShippingMethod {
              id
              name
              price {
                amount
                currency
              }
            }
          }
        }
      }
    }
  }
`;

export const ClearShippingMetadata = gql`
  mutation ClearShippingMetadata($id: ID!) {
    deleteMetadata(
      id: $id
      keys: ["free_shipping"]
    ) {
      errors {
        field
        code
        message
      }
    }
  }
`;

const ClearCheckoutDeliveryMethodMutation = gql`
  mutation ClearCheckoutDeliveryMethod($id: ID!) {
    checkoutDeliveryMethodUpdate(id: $id) {
      checkout {
        id
        deliveryMethod {
          ... on ShippingMethod {
            id
            name
          }
        }
      }
      errors {
        message
        variants
        code
        field
      }
    }
  }
`;

export const checkoutUpdatedWebhook = new SaleorAsyncWebhook<any>({
  name: "Checkout Updated",
  webhookPath: "/api/webhooks/checkout-updated",
  event: "CHECKOUT_UPDATED",
  apl: saleorApp.apl,
  query: CheckoutUpdatedSubscription,
});

export default checkoutUpdatedWebhook.createHandler(async (req, res, ctx) => {
  const { payload, authData } = ctx;

  const checkout = payload.checkout;

  if (!checkout?.id) {
    return res.status(200).json({ skipped: true, reason: "No checkout id" });
  }

  const currentSubtotal = Number(checkout.subtotalPrice?.gross?.amount ?? 0);
  const deliveryMethodId = checkout.deliveryMethod?.id ?? null;
  const isFreeShipping = checkout.free_shipping?.free_shipping == 'true';
  const totalBalance = checkout.totalBalance.amount ?? 0
  
  // Checkout is already paid and nothing has to change from this point onwards
  if (totalBalance == 0){
    return res.status(200).json({});
  }

  const client = createClient(authData.saleorApiUrl, async () => ({
    token: authData.token,
  }));

  if (!isFreeShipping && currentSubtotal > 1500) {
    const metadataResult = await client.mutation(MetadataUpdateDocument, {
      id: payload.checkout.id,
      input: [{
        key: 'free_shipping',
        value: 'true'
      }],
    });
    if (metadataResult.data?.updateMetadata?.errors && metadataResult.data.updateMetadata.errors.length > 0){
      console.log(metadataResult.data?.updateMetadata?.errors[0].message)
      return res.status(500).json({error: metadataResult.data?.updateMetadata?.errors[0].message});
    }
  }

  const shouldClearDeliveryMethod =
    !!deliveryMethodId &&
    (
      (currentSubtotal < FREE_SHIPPING_AMOUNT && isFreeShipping) ||
      (currentSubtotal >= FREE_SHIPPING_AMOUNT && !isFreeShipping)
    );

  if (!shouldClearDeliveryMethod) {
    return res.status(200).json({});
  }

  // Clear the delivery method update
  const clearShippingResult = await client.mutation(ClearCheckoutDeliveryMethodMutation, {
    id: checkout.id,
  })

  if (clearShippingResult.data?.checkoutDeliveryMethodUpdate?.errors && clearShippingResult.data.checkoutDeliveryMethodUpdate.errors.length > 0) {
    console.log("Error clearing delivery method");

    return res.status(500).json({
      error: clearShippingResult.data.checkoutDeliveryMethodUpdate.errors,
    });
  }

  // Clear shipping metadata
  const clearCacheResult = await client.mutation(ClearShippingMetadataDocument, {
    id: checkout.id,
  })

  if (clearCacheResult.data?.deleteMetadata?.errors && clearCacheResult.data.deleteMetadata.errors.length > 0){
    console.log("Error clearing metadata")
    return res.status(500).json({
      error: clearCacheResult.data.deleteMetadata.errors,
    });
  }

  // Call delivery methods recalculation
  const deliverycalculateResult = await client.mutation(DeliveryOptionsCalculateDocument, {
    id: checkout.id
  })

  if (deliverycalculateResult.data?.deliveryOptionsCalculate?.errors && deliverycalculateResult.data.deliveryOptionsCalculate.errors.length > 0){
    console.log(deliverycalculateResult.data.deliveryOptionsCalculate.errors[0].message)
    return res.status(500).json({
      error: deliverycalculateResult.data.deliveryOptionsCalculate.errors[0]
    });
  }

  return res.status(200).json({});
});

export const config = {
  api: {
    bodyParser: false,
  },
};