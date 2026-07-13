import { Router } from "express";
import { liveCheck, readyCheck } from "../controllers/index.js";

const router = Router();

router.get("/", readyCheck);
router.get("/live", liveCheck);
router.get("/ready", readyCheck);

export default router;
