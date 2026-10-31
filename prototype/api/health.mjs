import { json } from '../cloud/http.mjs';
import { tutorConfiguration } from '../cloud/tutor-config.mjs';
export default function health(req, res) {
  const ai = tutorConfiguration();
  const status = req.method !== 'GET' ? 405 : ai.requested && !ai.configured ? 503 : 200;
  return json(res, status, { service: 'confident-lab', mode: ai.enabled ? 'text_ai_pilot' : 'demonstration',
    audioEvaluation: false, generativeTutor: ai.enabled, webGenerativeTutor: false });
}
