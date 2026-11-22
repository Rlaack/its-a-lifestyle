# Relay

Stores public prekeys and queues ciphertext. It never sees private keys, readable messages, names or phone numbers.

```bash
docker compose up -d --build   # local: http://127.0.0.1:8787, data in the relay-data volume
```

Production (not set up yet): put Caddy or another TLS terminator in front, pin its certificate in the app, and turn on push wakeups. See `docs/encryption-design.md`.
