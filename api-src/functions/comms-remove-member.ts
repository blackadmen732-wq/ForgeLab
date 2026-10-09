import { handleRemoveMember } from "../comms.js";
import { commsDeps } from "../commsDeps.js";
import { serve } from "../http.js";

/** POST /api/comms/remove-member — remove a member (database-authorized) and evict from voice. */
export default serve((request) => handleRemoveMember(request, commsDeps()));
