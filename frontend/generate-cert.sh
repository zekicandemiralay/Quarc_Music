#!/bin/sh
set -e

CERT_DIR=/etc/nginx/ssl
CERT="$CERT_DIR/cert.pem"
KEY="$CERT_DIR/key.pem"

if [ -f "$CERT" ] && [ -f "$KEY" ]; then
    echo "[cert] Certificate already exists — skipping generation"
    exit 0
fi

mkdir -p "$CERT_DIR"
SERVER_IP="${SERVER_IP:-127.0.0.1}"
echo "[cert] Generating self-signed certificate for IP: $SERVER_IP"

# Write openssl config to a temp file (Alpine sh doesn't support process substitution)
cat > /tmp/openssl.cnf << OPENSSLEOF
[req]
distinguished_name = req_dn
x509_extensions    = v3_req
prompt             = no

[req_dn]
CN = Skynet Music

[v3_req]
subjectAltName      = @alt_names
keyUsage            = critical, digitalSignature, keyCertSign, cRLSign
extendedKeyUsage    = serverAuth
basicConstraints    = critical, CA:TRUE, pathlen:0

[alt_names]
IP.1  = ${SERVER_IP}
IP.2  = 127.0.0.1
DNS.1 = localhost
OPENSSLEOF

# 825 days = iOS 13+ maximum allowed validity for TLS certificates
openssl req -x509 -nodes \
    -newkey rsa:2048 \
    -keyout "$KEY" \
    -out   "$CERT" \
    -days  825 \
    -config /tmp/openssl.cnf

rm /tmp/openssl.cnf

echo "[cert] Done. Install the certificate on your devices:"
echo "[cert]   http://${SERVER_IP}/cert"
