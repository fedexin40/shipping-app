import axios from "axios";

export const api = axios.create({
  baseURL: process.env.SKYDROPX_API_URL ?? "",
  headers: {
    Authorization: `Token token=${process.env.SKYDROPX_API_KEY}`,
    "Content-Type": "application/json",
  },
});
