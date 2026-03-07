# Building Secure APIs for Financial Systems

In fintech, API security isn't optional — it's the foundation. A single vulnerability in a financial API can expose customer data, enable unauthorized transactions, and result in regulatory penalties.

Here's what I've learned building secure APIs for banking systems.

## The Security Layers

```
Request Flow:
Client → TLS/HTTPS → Rate Limiter → API Gateway
    → Authentication → Authorization → Input Validation
    → Business Logic → Encrypted Storage → Audit Log
```

Every request passes through multiple security layers before reaching business logic. Defense in depth — never rely on a single layer.

## 1. Authentication

### JWT with Short Expiry

```javascript
const token = jwt.sign(
  {
    userId: user.id,
    role: user.role,
    permissions: user.permissions
  },
  process.env.JWT_SECRET,
  {
    expiresIn: '15m',  // Short-lived access tokens
    algorithm: 'RS256'  // Use RSA, not HMAC
  }
);
```

### Key Practices

- **Access tokens**: 15 minutes max expiry
- **Refresh tokens**: Stored in httpOnly cookies, rotated on each use
- **RS256 over HS256**: Asymmetric keys prevent token forging even if the public key leaks
- **Token blacklisting**: Maintain a Redis set of revoked tokens

## 2. Authorization (RBAC)

```javascript
const permissions = {
  ADMIN: ['read', 'write', 'delete', 'approve_transaction'],
  MANAGER: ['read', 'write', 'approve_transaction'],
  OPERATOR: ['read', 'write'],
  VIEWER: ['read']
};

function authorize(...requiredPermissions) {
  return (req, res, next) => {
    const userPerms = permissions[req.user.role];
    const hasAccess = requiredPermissions.every(
      p => userPerms.includes(p)
    );

    if (!hasAccess) {
      return res.status(403).json({
        error: 'Insufficient permissions'
      });
    }
    next();
  };
}

// Usage
app.post('/api/transactions/approve',
  authenticate,
  authorize('approve_transaction'),
  transactionController.approve
);
```

## 3. Input Validation

Never trust client input. Validate everything at the API boundary:

```javascript
const transferSchema = Joi.object({
  sourceAccount: Joi.string()
    .pattern(/^[0-9]{10,16}$/)
    .required(),
  destinationAccount: Joi.string()
    .pattern(/^[0-9]{10,16}$/)
    .required(),
  amount: Joi.number()
    .positive()
    .precision(2)
    .max(1000000)
    .required(),
  remarks: Joi.string()
    .max(100)
    .pattern(/^[a-zA-Z0-9\s]+$/)  // No special chars
    .optional()
});
```

### Preventing Injection

- **SQL Injection**: Always use parameterized queries
- **NoSQL Injection**: Sanitize MongoDB queries, reject `$` operators in user input
- **XSS**: Encode output, use Content-Security-Policy headers

## 4. Rate Limiting

```javascript
const rateLimit = require('express-rate-limit');

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests' }
});

// Strict limit for sensitive endpoints
const transactionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,  // Only 5 transactions per minute
  keyGenerator: (req) => req.user.id
});

app.use('/api/', apiLimiter);
app.use('/api/transactions', transactionLimiter);
```

## 5. Encryption

### Data at Rest
- Encrypt sensitive fields (account numbers, PAN) using AES-256
- Use envelope encryption with AWS KMS or similar

### Data in Transit
- TLS 1.3 minimum
- Certificate pinning for mobile apps
- HSTS headers

```javascript
// Encrypt sensitive data before storage
const crypto = require('crypto');

function encryptField(plaintext, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}
```

## 6. Audit Logging

Every action in a financial system must be logged immutably:

```javascript
async function auditLog(action, userId, details) {
  await AuditLog.create({
    action,          // 'TRANSACTION_INITIATED'
    userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    details,
    timestamp: new Date(),
    hash: generateHash(action, userId, details) // Tamper detection
  });
}
```

## Security Checklist

- [ ] HTTPS everywhere (no HTTP fallback)
- [ ] JWT with RS256 and short expiry
- [ ] Role-based access control
- [ ] Input validation on every endpoint
- [ ] Rate limiting (general + per-endpoint)
- [ ] SQL/NoSQL injection prevention
- [ ] Sensitive data encryption (AES-256)
- [ ] Audit logging for all mutations
- [ ] Security headers (CORS, CSP, HSTS)
- [ ] Dependency vulnerability scanning

---

*Security is not a feature — it's a requirement. These practices come from building APIs that handle real financial data.*
