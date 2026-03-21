import { Router } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config";

const router = Router();

// モックユーザーのログインエンドポイント
// 実際のシステムではDBから検証する
router.post("/login", (req, res) => {
  const { username, _password } = req.body;

  // 簡易的な検証: パスワードは問わず、適当なユーザーIDとしてトークンを発行
  if (username) {
    const token = jwt.sign({ userId: username }, JWT_SECRET, {
      expiresIn: "24h",
    });
    res.json({ token, userId: username });
  } else {
    res.status(400).json({ error: "Username is required" });
  }
});

export default router;
