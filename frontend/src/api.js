export async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: isForm ? options.headers : { 'Content-Type': 'application/json', ...options.headers },
    body: options.body && !isForm ? JSON.stringify(options.body) : options.body,
  });
  const json = await response.json();
  if (!response.ok || !json.ok) {
    const error = new Error(json.error?.message || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return json.data;
}
export const statusText = { ready_for_seller_review: 'Ready for seller review', information_missing: 'Information missing', specialist_review_required: 'Specialist review required' };
export const statusArabic = { ready_for_seller_review: 'جاهز لمراجعة البائع', information_missing: 'معلومات ناقصة', specialist_review_required: 'مراجعة مختص مطلوبة' };
export function navigate(page, id) { window.location.hash = id ? `${page}/${id}` : page; }
