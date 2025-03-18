import { axiosInstance } from "./axios"

export interface address {
  country_code: string,
  postal_code: string,
  area_level1: string,
  area_level2: string,
  area_level3: string,
  street1: string,
  reference: string,
  company: string,
  phone: string | undefined | null,
  email: string,
  firstName?: string,
  lastName?: string
}

interface bodyQuotation {
  quotation: {
    address_from: address,
    address_to: address,
    parcel: {
      length: number,
      width: number,
      height: number,
      weight: number
    },
    requested_carriers: string[]
  }
}

interface bodyShipping {
  shipment: {
    quotation_id?: string,
    rate_id?: string,
    address_from: address,
    address_to: address,
    consignment_note: string,
    package_type: string
  }
}

export const getQuotation = async (id: string) => {
  const url = `/api/v1/quotations/${id}`
  let is_completed = false
  let answer
  while (!is_completed) {
    answer = await axiosInstance.get(url)
    is_completed = answer.data.is_completed
  }
  return answer
}

export const createQuotation = async (body: bodyQuotation) => {
  let answer = await axiosInstance.post(
    '/api/v1/quotations', body
  )
  // Skydropx flow is: first create the quotation
  // later with the quoation_id query again and see for 
  // is_completed equal to true
  const quotation_id = answer.data.id
  let is_completed = false
  while (!is_completed) {
    // Stop the execution for a second to avoid multiple calls
    await new Promise(resolve => setTimeout(resolve, 1000));
    const url = `/api/v1/quotations/${quotation_id}`
    answer = await axiosInstance.get(url)
    is_completed = answer.data.is_completed
  }
  return answer
}

export const createShipping = async (body: bodyShipping) => {
  const answer = await axiosInstance.post("/api/v1/shipments", body)
  if (answer.status >= 400)
    return answer

  let tracking_number
  let answer_get_shipping
  while (!tracking_number) {
    // Stop the execution for a second to avoid multiple calls
    await new Promise(resolve => setTimeout(resolve, 1000));
    const url = `/api/v1/shipments/${answer.data.data.attributes.id}`
    answer_get_shipping = await axiosInstance.get(url)
    tracking_number = answer_get_shipping.data.included[0].attributes.tracking_number;
  }
  return answer_get_shipping
}

export const trackingShipment = async (body: { tracking_number: string, carrier_name: string }) => {
  const url = `/api/v1/shipments/tracking?tracking_number=${body.tracking_number}&carrier_name=${body.carrier_name}`
  console.log(url)
  try {
    const answer = await axiosInstance.get(url)
    return answer
  } catch (error) {
    console.log(error)
  }
}
