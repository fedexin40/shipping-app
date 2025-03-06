import axios from "axios";


export const axiosInstance = axios.create({
  baseURL: process.env.SKYDROPX_API_URL ?? "",
});

const getAccessToken = async () => {
  try {
    const response = await axiosInstance.post(
      '/api/v1/oauth/token', {
      client_id: process.env.client_id || '',
      client_secret: process.env.client_secret || '',
      grant_type: 'client_credentials'
    })
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