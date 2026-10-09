import { handleVoiceToken } from "../comms.js";
import { commsDeps } from "../commsDeps.js";
import { serve } from "../http.js";

/** POST /api/voice/token — short-lived token for exactly one channel's voice room. */
export default serve((request) => handleVoiceToken(request, commsDeps()));
