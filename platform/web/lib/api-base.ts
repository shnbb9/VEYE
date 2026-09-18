/** Build an API path for the same-origin Nginx proxy or an explicit local API. */
export const apiBaseUrl = (value = process.env.NEXT_PUBLIC_API_URL) => String(value ?? "").trim().replace(/\/+$/, "");

export const apiPath = (path: string, base = process.env.NEXT_PUBLIC_API_URL) => {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${apiBaseUrl(base)}${suffix}`;
};
