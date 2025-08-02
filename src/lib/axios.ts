import axios from "axios";
import NodeCache from "node-cache";

const myCache = new NodeCache();

export const axiosInstance = axios.create({
  baseURL: process.env.SKYDROPX_API_URL ?? "",
});

const getAccessToken = async () => {
  const token = myCache.get('skydropx-token')
  if (token) {
    return token
  }
  try {
    const response = await axiosInstance.post(
      '/api/v1/oauth/token', {
      client_id: process.env.client_id || '',
      client_secret: process.env.client_secret || '',
      grant_type: 'client_credentials'
    })
    myCache.set(
      "skydropx-token",
      response.data.access_token,
      response.data.expires_in
    );
    return response.data.access_token
  } catch (error) {
    console.log(error)
  }
}

axiosInstance.interceptors.request.use(async (config) => {
  if (config.url == '/api/v1/oauth/token') {
    return config
  }
  const token = await getAccessToken()
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});