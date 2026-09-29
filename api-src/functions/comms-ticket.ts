import { handleTicket } from "../comms.js";
import { commsDeps } from "../commsDeps.js";
import { serve } from "../http.js";

/** POST /api/comms/ticket — signed presence ticket for a project member. */
export default serve((request) => handleTicket(request, commsDeps()));
