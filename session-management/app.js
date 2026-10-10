import { createClient } from 'redis';
import express from 'express';

const PORT = 8080;
const SESSION_TTL_SECONDS = 60;

const app = express();
app.use(express.json());

const redisClient = createClient();
await redisClient.connect();

const cartKey = (sessionId) => `cart:${sessionId}`;
const getCart = (sessionId) => redisClient.lRange(cartKey(sessionId), 0, -1);

// Middleware: pull sessionId from the Cookie header and make sure it exists in Redis
async function requireSession(req, res, next) {
  const sessionId = (req.get('Cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('sessionId='))
    ?.split('=')[1];

  if (!sessionId) {
    return res.status(401).send({ error: 'Unauthorized. Missing session token/cookie.' });
  }

  if (!(await redisClient.exists(sessionId))) {
    return res.status(401).send({ error: 'Session expired or invalid. Please log in again.' });
  }

  req.sessionId = sessionId;
  next();
}

// POST /login
app.post('/login', async (req, res) => {
  const sessionId = 'sess:9a8b7c';

  // Create the session and set its TTL
  await redisClient
    .multi()
    .hSet(sessionId, { uid: 'usr_1024', username: 'alice_dev' })
    .expire(sessionId, SESSION_TTL_SECONDS)
    .exec();

  res.send({ message: 'Logged in successfully!', token: sessionId });
});

// GET /cart
app.get('/cart', requireSession, async (req, res) => {
  res.send({ status: 'Authenticated', cart: await getCart(req.sessionId) });
});

// POST /cart - accepts a single item or an array of items
app.post('/cart', requireSession, async (req, res) => {
  const itemsToAdd = [].concat(req.body.items ?? []);

  if (itemsToAdd.length === 0) {
    return res.status(400).send({ error: "Bad Request. 'items' array or string is required." });
  }

  await redisClient.rPush(cartKey(req.sessionId), itemsToAdd);

  res.send({ message: 'Cart updated successfully', cart: await getCart(req.sessionId) });
});

// DELETE /logout/:sessionId - remove the session and its cart
app.delete('/logout/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  await redisClient.del([sessionId, cartKey(sessionId)]);

  res.send({ status: 'Logged out successfully. Session destroyed.' });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));