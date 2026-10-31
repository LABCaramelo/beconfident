import { getRuntime } from '../cloud/runtime.mjs';
import { json } from '../cloud/http.mjs';
export default async function state(req, res) {
  try { req.url = '/api/state'; return await getRuntime().web(req, res); }
  catch { return json(res, 503, { error: 'Não foi possível carregar agora. Tente novamente.' }); }
}
