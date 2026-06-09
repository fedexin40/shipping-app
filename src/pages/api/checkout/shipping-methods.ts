import type { NextApiRequest, NextApiResponse } from "next";
import { createQuotation, type address as SkydropxAddress } from "../../../lib/skydropx";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({
        error: "address is required",
      });
    }

    const shippingAddress = address as SkydropxAddress;

    if (!shippingAddress.country_code || !shippingAddress.postal_code) {
      return res.status(400).json({
        error: "country_code and postal_code are required",
        address: shippingAddress,
      });
    }

    const body = {
      quotation: {
        address_from: {
          country_code: "mx",
          postal_code: "72180",
          area_level1: "Pue.",
          area_level2: "Puebla",
          area_level3: "Colonia Nueva Antequera"
        },
        address_to: {
          country_code: shippingAddress.country_code || "mx",
          postal_code: shippingAddress.postal_code,
          area_level1: shippingAddress.area_level1 || "N/A",
          area_level2: shippingAddress.area_level2 || "N/A",
          area_level3: shippingAddress.area_level3 || "N/A"
        },
        parcel: {
          length: 10,
          width: 10,
          height: 10,
          weight: 1,
        },
        requested_carriers: ["fedex", "estafeta", "dhl", "ups"],
      },
    };

    const response = await createQuotation(body);

    if (response.status >= 400) {
      return res.status(response.status).json({
        error: "Failed to get Skydropx rates",
        detail: response.statusText,
      });
    }

    const data = response.data;
    const shipping = data.rates
      .filter((rate: any) => rate.success)
      .sort((a: any, b: any) => Number(a.total) - Number(b.total));

    return res.status(200).json({
      quotation_id: data.id,
      shipping_methods: shipping
    });
  } catch (error) {
    console.error("Shipping methods API error:", error);

    return res.status(500).json({
      error: "Unexpected error getting shipping methods",
    });
  }
}