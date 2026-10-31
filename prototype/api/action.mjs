import { getRuntime } from '../cloud/runtime.mjs';
import { json } from '../cloud/http.mjs';
export default async function action(req, res) {
  try { req.url = '/api/action'; return await getRuntime().web(req, res); }
  catch { return json(res, 503, { error: 'Não foi possível salvar agora. Tente novamente.' }); }
}
