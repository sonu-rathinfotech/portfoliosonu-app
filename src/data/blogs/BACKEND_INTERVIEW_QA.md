# Interview Questions & Answers — PipingMart Backend

Based on the actual code in `pipeingMartBackend_staginDev/pipeingMartBackend/`.
Each question maps to a real solution implemented in this codebase.

---

## Table of Contents

### Section A: Core Topics (Q&A)

1. [Architecture & Project Structure](#1-architecture--project-structure)
2. [Authentication & Session Management](#2-authentication--session-management)
3. [Redis — Caching, Sessions & OTP](#3-redis--caching-sessions--otp)
4. [MongoDB & Mongoose Patterns](#4-mongodb--mongoose-patterns)
5. [Aggregation Pipelines](#5-aggregation-pipelines)
6. [Email System (AWS SES)](#6-email-system-aws-ses)
7. [File Uploads (Multer + S3)](#7-file-uploads-multer--s3)
8. [Cron Jobs & Background Processing](#8-cron-jobs--background-processing)
9. [BullMQ — Job Queues & Workers](#9-bullmq--job-queues--workers)
10. [URL Generation & SEO](#10-url-generation--seo)
11. [Search & Pagination](#11-search--pagination)
12. [RFQ Distribution Algorithm](#12-rfq-distribution-algorithm)
13. [Supplier Ranking & Plan-Based Logic](#13-supplier-ranking--plan-based-logic)
14. [Error Handling & Response Patterns](#14-error-handling--response-patterns)
15. [Middleware Design](#15-middleware-design)
16. [Socket.io — Real-Time Events](#16-socketio--real-time-events)
17. [Data Migration](#17-data-migration)
18. [Security Considerations](#18-security-considerations)
19. [Environment & Configuration Management](#19-environment--configuration-management)
20. [Design Patterns Used](#20-design-patterns-used)
21. [Express.js Deep Dive — Middleware Stack](#21-expressjs-deep-dive--middleware-stack)
22. [Node.js Core Concepts in This Project](#22-nodejs-core-concepts-in-this-project)
23. [Input Validation (express-validator)](#23-input-validation-express-validator)
24. [Logging Architecture (Winston + Morgan)](#24-logging-architecture-winston--morgan)
25. [Rate Limiting & IP Blocking System](#25-rate-limiting--ip-blocking-system)
26. [Image Processing Pipeline (Sharp + S3)](#26-image-processing-pipeline-sharp--s3)
27. [Sitemap Generation System](#27-sitemap-generation-system)
28. [Process Management & Health](#28-process-management--health)

### Section B: Backend Optimizations & Improvements

- [PART 1: Optimizations Already Done (OPT-1 to OPT-14)](#part-1-optimizations-already-done)
- [PART 2: Improvements To Make (IMP-1 to IMP-16)](#part-2-improvements-to-make)
- [PART 3: Priority Matrix](#part-3-priority-matrix)

### Section C: Must-Know Interview Questions (Rapid-Fire)

- [MK-1 to MK-25: Common backend interview questions mapped to project code](#mk-1-how-do-you-handle-file-uploads-in-nodejs)

---

## 1. Architecture & Project Structure

### Q: Describe the overall architecture of this backend system.

**A:** It's a **Node.js/Express monolithic API server** that powers a B2B marketplace for piping/industrial products. The architecture:

```
Client (Angular SSR) ──→ Express API (port 3050)
                              │
                              ├──→ MongoDB (Mongoose ODM — named connection)
                              ├──→ Redis (sessions + caching + OTP + blocked lists)
                              ├──→ AWS SES (transactional & bulk email)
                              ├──→ AWS S3 (image/file uploads, bucket: pipingmartassets)
                              ├──→ BullMQ (async background job processing)
                              ├──→ Socket.io (real-time supplier signup notifications)
                              └──→ node-cron (scheduled jobs: email, RFQ, sitemap)
```

**Entry point:** `webServers/pipingMart.js` → requires `app.js` → starts HTTP server + Socket.io.

**Key files:**
- `app.js` — Express middleware stack, route mounting, cron initialization
- `routes/` — Top-level routers (userRoutes, productCategoryGradesRoutes, suppliersRoutes, emailLogic)
- `modules/admin/` — Modular admin APIs with Controller → Service → Model layering
- `lib/` — Core utilities (auth, constants, DB connection, email sender, helpers)
- `helper/` — Business logic helpers (S3 upload, email assignment, plan expiry)
- `crons/` — Scheduled job definitions and launchers

---

### Q: How are the admin modules structured? What design pattern do they follow?

**A:** The admin modules at `modules/admin/` follow a **layered MVC + Service pattern**. Each module has:

```
modules/admin/{domain}/
  ├── controllers/    → Extract request, call service, return response
  ├── routes/         → Express router with auth middleware + validation rules
  ├── services/       → Business logic & database operations
  │   ├── create.js
  │   ├── list.js
  │   ├── update.js
  │   ├── get.js
  │   └── index.js    → Aggregates all service exports
  └── validations/    → express-validator rules (body/check/custom)
```

**Example flow** for creating a material-grade:
1. **Route** mounts multer middleware for file upload + validation rules + auth
2. **Controller** checks `validationResult(req)`, calls `service.create(req)`
3. **Service** uploads logo to S3, generates grade code, creates DB record, creates linked AllModule record
4. Returns response via `generateJsonResponse()`

Modules: email, grade, material, material-grade, equivalent-grade, material-sub-product-product, dashboard, plan, user, allModule (BullMQ), Rfqs, blockEmail, IpAddress, shouldSendRfqEmail

---

## 2. Authentication & Session Management

### Q: How does authentication work in this system? Is it JWT or session-based?

**A:** It's **session-based authentication using Redis** — not JWT, despite the frontend calling it "JwtInterceptor".

**Login flow** (`routes/userRoutes.js`):
1. `POST /auth/login` — validates email/password via bcrypt
2. On success, stores user data in Redis: `saveSessionDetails(req.sessionID, userData)`
3. Returns `{ status: 1, user: { ...userData, token: req.sessionID } }`
4. The `token` field is actually the Express session ID

**Subsequent requests:**
1. Client sends token in `auth` HTTP header (not `Authorization`)
2. `authoriseUser` middleware in `lib/Authorisation.js` reads `req.headers.auth`
3. Fetches session data from Redis: `redisClient.get(token)`
4. Attaches parsed user to `req.user` and `res.user`
5. If not found → 401 "Please login/ sign up to continue."

**Session TTL:** 30 days (2,592,000 seconds) defined in `lib/Constant.js`

```javascript
// lib/Authorisation.js — core middleware
const authoriseUser = (req, res, next) => {
  let token = req.headers.auth;
  if (!token) return res.status(401).json({ message: "Please login" });
  redisClient.get(token, (err, data) => {
    if (data) {
      req.user = JSON.parse(data);
      next();
    } else {
      return res.status(401).json({ message: "Session expired" });
    }
  });
};
```

---

### Q: How are role-based permissions handled?

**A:** Two-level approach:

1. **`authoriseUser`** — Checks if user is logged in (session exists in Redis)
2. **`onlyAdmin`** — Checks `req.user.isAdmin === true`

Applied as middleware chain:
```javascript
Router.post("/addSeller", [authoriseUser, onlyAdmin, addSellerByAdmin]);
```

Users have three flags: `isSeller`, `isAdmin`, `isNormalUser`. These are set at signup and can be changed by admin.

---

## 3. Redis — Caching, Sessions & OTP

### Q: What are the different uses of Redis in this system?

**A:** Redis serves **four distinct purposes**:

**1. Session Storage** — Auth tokens stored with 30-day TTL
```javascript
saveSessionDetails(sessionID, userData) // SET sessionID JSON_DATA EX 2592000
```

**2. OTP Storage** — One-time passwords with 5-minute TTL
```javascript
redisClient.set(phoneNo, JSON.stringify({otp}), "EX", 300) // 5 min expiry
```

**3. Search Result Caching** — Product/grade search results cached 5 minutes
```javascript
// productCategoryGradesRoutes.js
let cached = await redisClient.getAsync("search_result_|_" + search);
if (cached) return handleSuccessResponse(JSON.parse(cached), res);
// ... do search ...
await redisClient.setAsync("search_result_|_" + search, JSON.stringify(results), "EX", 300);
```

**4. Blocked Email/IP Lists** — Spam prevention
```javascript
const BLOCKED_EMAIL_LIST_IN_REDIS = 'blocked_emails_list';
let blocked = await redisClient.lrangeAsync(BLOCKED_EMAIL_LIST_IN_REDIS, 0, 1000);
```

**Cache key prefixes** (from `lib/Constant.js`):
- `cached_home_page_product_data` — Homepage products
- `cached_home_page_top_bar_data` — Homepage top bar
- `grade_id_array` / `product_id_array` — ID lookup caches
- `sub_products_details_` — Sub-product data
- `blog_downloaded` — Blog post cache
- `prev_supplier_shown_details` — Previous supplier display

---

### Q: How is OTP verification implemented?

**A:** OTP flow uses Redis as a temporary store with TTL:

**Generate** (`/auth/generateOTP/:phoneNumber`):
1. Generate random 5-digit OTP: `Math.floor(Math.random() * 100000)`
2. Check if OTP already exists in Redis for this phone/email
3. If exists, reuse same OTP (prevents multiple different OTPs)
4. Send OTP via AWS SES email or SMS (via external API)
5. Store in Redis: `SET phoneNo {otp: "12345"} EX 300`
6. Also saves to `UnregisteredModel` for tracking incomplete registrations

**Verify** (`/auth/verify`):
1. Fetch stored OTP from Redis: `GET phoneNo`
2. Compare: `parsedData.otp === otp.toString()`
3. Return verified or mismatch

**Security:** OTP expires in 300 seconds (5 minutes). If user requests new OTP within TTL, same OTP is returned.

---

## 4. MongoDB & Mongoose Patterns

### Q: Why does this project use `mongoose.createConnection()` instead of `mongoose.connect()`?

**A:** The codebase uses a **named connection** pattern via `mongoose.createConnection()` in `lib/dbConnection.js`:

```javascript
const CONN_TO_DB = mongoose.createConnection(MONGODB_ADDRESS, options);
module.exports = { CONN_TO_DB };
```

All models register on this named connection:
```javascript
const Suppliers = CONN_TO_DB.model('suppliers', supplierSchema);
```

This allows:
- **Multiple database connections** in the same application if needed
- **Explicit control** over which connection each model uses
- Models are NOT globally registered on the default mongoose connection

**Important:** If you use `mongoose.model()` instead of `CONN_TO_DB.model()`, queries will silently fail because they'll target the wrong (default) connection.

---

### Q: How does soft delete work in this codebase?

**A:** Instead of deleting records, queries filter by `deletedAt: null`:

```javascript
// In admin module services
const gradeQuery = { deletedAt: null };
const findGrades = await GradeModel.find(gradeQuery, null, options);
```

**Update status** uses a dedicated endpoint:
```javascript
// services/update-status.js
const update = await Model.findByIdAndUpdate(id, { isActive: value }, { new: true });
```

This preserves data integrity — records are never truly deleted, just marked inactive or given a `deletedAt` timestamp.

---

## 5. Aggregation Pipelines

### Q: Give an example of a complex MongoDB aggregation pipeline used in this project.

**A:** The **Hot Product Supplier Ranking** pipeline (`routes/userRoutes.js`) is the most complex. It joins 3 collections, calculates date differences, and sorts by plan priority:

```javascript
let hotProductSupplier = await HotProductSuppliers.aggregate([
  // Stage 1: Match by product + material
  { $match: { productId: productId?.toString(), materialId: materialId?.toString() } },

  // Stage 2: Lookup users with plan filtering
  { $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "userId",
      as: "userId",
      pipeline: [
        // Only users with matching plan and email budget
        { $match: {
            planId: { $in: planIds.map(e => new mongoose.Types.ObjectId(e)) },
            remainingEmailLimit: { $gt: 0 }
        }},
        // Calculate days until plan expires
        { $addFields: {
            plainExpiresInDays: {
              $dateDiff: { startDate: "$$NOW", endDate: "$planExpiryDate", unit: "day" }
            }
        }},
        // Only active plans (expiring within 75 days)
        { $match: { plainExpiresInDays: { $gt: 0, $lte: 75 } } },
        // Lookup plan details
        { $lookup: { from: "plan", localField: "planId", foreignField: "_id", as: "planId" } },
        { $unwind: { path: "$planId", preserveNullAndEmptyArrays: false } },
        { $sort: { 'email.currentEmailSent': -1 } }
      ]
  }},
  // Stage 3: Flatten
  { $unwind: { path: "$userId", preserveNullAndEmptyArrays: false } }
]);
```

**What it does:** Finds all "hot product" suppliers for a given product+material, joins their user profiles, filters by plan validity and email budget, calculates plan expiry, and sorts by email activity.

---

### Q: How does the $facet operator help with product catalog queries?

**A:** The `$facet` operator runs **multiple aggregation pipelines in parallel** on the same dataset. Used in `productCategoryGradesRoutes.js` to batch-fetch materials per product:

```javascript
// Build dynamic facet query — one pipeline per product
let facet_query_materials = {};
for (let i = 0; i < products.length; i++) {
  facet_query_materials[products[i].productId] = [
    { $match: { productId: products[i].productId, deletedAt: null } }
  ];
}

// Single DB call returns all products' materials grouped
let materials_aggs = await Materials.aggregate([
  { $facet: facet_query_materials }
]);
```

**Result structure:**
```json
{
  "PROD_001": [{ materialId: "M1", name: "Stainless Steel" }, ...],
  "PROD_002": [{ materialId: "M2", name: "Carbon Steel" }, ...],
  ...
}
```

**Why it matters:** Without `$facet`, you'd need N separate DB queries (one per product). `$facet` does it in one round-trip.

---

### Q: Explain the `$lookup` with a `let` + `pipeline` pattern.

**A:** This is a **correlated sub-query** pattern used when you need to join collections with multiple conditions or transformations:

```javascript
// suppliersRoutes.js — lookup with variable substitution
{
  $lookup: {
    from: "productmaterialmaps",
    let: { productId: "$_id.productId", materialId: "$_id.materialId" },
    pipeline: [
      { $match: {
          $expr: {
            $and: [
              { $eq: ["$materialId", "$$materialId"] },
              { $eq: ["$productId", "$$productId"] }
            ]
          }
      }},
      { $project: { materialId: 1, productId: 1, url: 1 } }
    ],
    as: "productMaterial"
  }
}
```

**How it works:**
1. `let` defines variables (`$$materialId`, `$$productId`) from the outer document
2. `pipeline` uses `$expr` to reference those variables inside `$match`
3. This lets you join on multiple fields and apply additional filtering/projection

**vs simple `$lookup`:** Simple lookup only joins on one `localField` = `foreignField`. The `let/pipeline` pattern enables complex multi-field joins.

---

## 6. Email System (AWS SES)

### Q: How does the email system work? What are the two sending modes?

**A:** The system uses AWS SES through `lib/Notifier.js` with two modes:

**Mode 1: `sendMail()` — Simple Email (SES v1)**
```javascript
function sendMail(to, subject, text, html, from, attachments, replyTo, cc, bcc) {
  let params = {
    Source: from || '"Thepipingmart.in" <no-reply@pipingmart.in>',
    Destination: { ToAddresses: to instanceof Array ? to : [to] },
    Message: {
      Body: { Html: { Charset: 'UTF-8', Data: html } },
      Subject: { Charset: 'UTF-8', Data: subject }
    }
  };
  AWS_SES.sendEmail(params, callback);
}
```
Used for: OTP emails, simple notifications.

**Mode 2: `sendRawEmail()` — Raw Email with Attachments (SES v2)**
```javascript
function sendRawEmail(message) {
  // Uses nodemailer MailComposer to build MIME message
  let mailOptions = { from, to, subject, html, attachments };
  let rawData = await new MailComposer(mailOptions).compile().build();

  // Sends individually to each recipient
  for (let i = 0; i < to.length; ++i) {
    let params = {
      Content: { Raw: { Data: rawData } },
      Destination: { ToAddresses: [to[i]] },
      FromEmailAddress: message.from,
      ReplyToAddresses: replyTo
    };
    AWS_SES2.sendEmail(params, callback);
  }
}
```
Used for: Enquiry emails with file attachments, RFQ distribution.

**Key difference:** `sendRawEmail` uses nodemailer's `MailComposer` to handle MIME encoding for attachments, then sends via SES v2's `sendEmail` with raw data.

---

### Q: How does inbound email processing work?

**A:** The `/notify/insertEmail` endpoint processes incoming emails forwarded from SES:

```javascript
const processReceivedEmail = async (userIp, mailContent) => {
  // 1. Parse raw email with simpleParser (mailparser)
  let parsedEmail = await simpleParser(mailContent.content);

  // 2. Extract sender info
  let from_email = parsedEmail.headers.from.text.split('<')[1].replace('>', '');

  // 3. Check blocks — IP block + email block + domain filter
  let ipStatus = await checkTemporaryBlockAndPermanentBlockForIPAddress(userIp);
  let blocked = blocked_emails.includes(from_email);
  if (from_email.includes('@pipingmart.in')) return; // Skip internal

  // 4. Save attachments to disk
  for (const file of attachments) {
    fs.writeFile(`uploads/${filename}`, bufferData, callback);
  }

  // 5. Store email in database
  let email = new Emails({
    senderEmail: from_email,
    receiverEmail: to,
    emailType: 'enquiry',
    emailContent: { subject, html, attachments },
    ipAddress: userIp,
    senderDetails: { name, email, mobileNo, country }
  });
  await email.save();

  // 6. Forward to support team via SES
  await sendRawEmail({ to: defaultReceiver, subject, html, attachments });
};
```

---

### Q: How does email scheduling work?

**A:** Two-phase system:

**Phase 1: Schedule** — Save email with future execution time:
```javascript
if (isSchedule === "true") {
  scheduleDate = await getUTC_datetime(new Date(scheduleOn)); // Convert to UTC
  // Save to ScheduledEmails model
  new ScheduledEmails({
    to, subject, html, from,
    nextExecutionTime: scheduleDate,
    active: true, retry: 0
  }).save();
}
```

**Phase 2: Cron Processing** — Every 30 seconds, check and send:
```javascript
// crons/cronJobs.js — runs every 30 seconds
const sendScheduledEmails = async () => {
  let emails = await ScheduledEmails.find({
    active: true,
    nextExecutionTime: { $lte: new Date() } // Due now or overdue
  });

  for (let email of emails) {
    try {
      await sendRawEmail({ to: email.to, subject: email.subject, html: email.html });
      email.active = false; // Mark as sent
    } catch (e) {
      email.retry += 1;
      if (email.retry >= 5) email.active = false; // Give up after 5 retries
    }
    await email.save();
  }
};
```

---

## 7. File Uploads (Multer + S3)

### Q: Describe the file upload pipeline from client to S3.

**A:** Three-stage pipeline: Client → Multer (disk) → Sharp (transform) → S3 (cloud)

**Stage 1: Multer receives file**
```javascript
const upload = multer({ dest: "uploads/" });
Router.post("/upload", [upload.single("uploadedFile"), uploadFile]);
```

**Stage 2: Sharp converts to WebP** (in `helper/uploadToS3.js`)
```javascript
const uploadToS3 = async (fileName, filePath, s3Path) => {
  // Convert to WebP format for optimization
  const newFileName = `${fileName.replace(/[^a-zA-Z0-9]/g, "")}-${Date.now()}.webp`;
  const outputPath = `${filePath}.webp`;
  await sharp(filePath).webp().toFile(outputPath);

  // Read converted file
  const fileContent = fs.readFileSync(outputPath);
  const params = {
    Bucket: "pipingmartassets",
    Key: `${s3Path}${newFileName}`,
    Body: fileContent
  };

  // Upload to S3
  const aws_out = await S3.upload(params).promise();

  // Cleanup temp files
  fs.unlinkSync(filePath);      // Remove original
  fs.unlinkSync(outputPath);    // Remove WebP temp
  return { aws_out };
};
```

**Stage 3: Return URL**
```javascript
const logoUrl = `${process.env.IMAGE_BASE_URL}${upload.aws_out.key}`;
```

**Error handling:** Every upload path has `fs.unlinkSync()` in both success and error branches to prevent disk accumulation.

---

## 8. Cron Jobs & Background Processing

### Q: How are cron jobs organized? What scheduling patterns exist?

**A:** **Two separate cron systems** run in parallel:

**System 1: `app.js`** (controlled by `RUN_CRON` env var)
```javascript
if (process.env.RUN_CRON !== "false") {
  cron.schedule("0 1 * * *",   () => { newEmailAssignToSupplier(); OneYearExtendFreeSupplier(); });
  cron.schedule("0 8 * * *",   () => { sendRfqToFreeSuppliers(); });
  cron.schedule("30 * * * * *", () => { scheduleEmailCron(); });  // Every 30 sec
  cron.schedule("30 1 * * 1",  () => { resetEmailLimit(); });     // Monday 1:30AM
}
```

**System 2: `crons/luncher.js`** (always runs, Asia/Kolkata timezone)
```javascript
cron.schedule("0 0 * * *",   updateEmailRenewDate,           { timezone: "Asia/Kolkata" });
cron.schedule("*/30 * * * *", notifyAdminUnregisteredUser,    { timezone: "Asia/Kolkata" });
cron.schedule("*/50 * * * *", fetchBlogPost,                  { timezone: "Asia/Kolkata" });
cron.schedule("0 0 * * *",   update_product_site_map,         { timezone: "Asia/Kolkata" });
cron.schedule("0 1 * * *",   update_product_grade_sitemap,    { timezone: "Asia/Kolkata" });
cron.schedule("0 2 * * *",   update_material_site_map,        { timezone: "Asia/Kolkata" });
```

**What each cron does:**
| Job | Schedule | Purpose |
|-----|----------|---------|
| `newEmailAssignToSupplier` | Daily 1AM | Rotate supplier assigned email IDs |
| `OneYearExtendFreeSupplier` | Daily 1AM | Auto-extend expired free plans by 1 year |
| `sendRfqToFreeSuppliers` | Daily 8AM | Distribute RFQs to free-tier suppliers |
| `scheduleEmailCron` | Every 30 sec | Process scheduled email queue |
| `resetEmailLimit` | Monday 1:30AM | Reset monthly email counters |
| `notifyAdminUnregisteredUser` | Every 30 min | Alert admin about incomplete registrations |
| `fetchBlogPost` | Every 50 min | Pull blog posts from WordPress API |
| Sitemap jobs | Midnight/1AM/2AM | Regenerate XML sitemaps |

---

### Q: How does the email limit reset work?

**A:** Monthly reset process in `helper/reset-email-limit.js`:

```javascript
const resetEmailLimit = async () => {
  // 1. Fetch all non-admin suppliers with their plan details
  let suppliers = await Users.find({ isAdmin: false }).populate("planId");

  for (let supplier of suppliers) {
    let plan = supplier.planId;
    if (!plan) continue;

    // 2. Reset email counters to plan limits
    supplier.emailPlan.currentEmailSent = 0;
    supplier.remainingEmailLimit = plan.emailLimit;
    supplier.totalEmailLimit = plan.emailLimit;

    await supplier.save();
  }
};
```

**When:** Runs every Monday at 1:30 AM. Resets `currentEmailSent` to 0 and restores `remainingEmailLimit` to the plan's defined limit.

---

## 9. BullMQ — Job Queues & Workers

### Q: How is BullMQ used for background processing? Give a concrete example.

**A:** BullMQ handles **asynchronous data mapping** operations that generate thousands of records. Located in `modules/admin/allModule/bullmq/`.

**Architecture:**
```
Controller (HTTP request)
    ↓ enqueue job
BullMQ Queue (Redis-backed)
    ↓ dequeue
Worker (processes in background, concurrency: 1)
    ↓
allModule.logic.js (heavy DB operations)
```

**4 Queues defined** (`bullmq/Queues.js`):
```javascript
const { Queue } = require("bullmq");
const connection = require("./connection"); // Redis localhost:6379

exports.productMaterialMapQueues   = new Queue("PRODUCT_MATERIAL_MAP", { connection });
exports.materialGradeMapQueues     = new Queue("MATERIAL_GRADE_MAP", { connection });
exports.gradeEqgradeMapQueues      = new Queue("GRADE_EQGRADE_MAP", { connection });
exports.productSubproductMapQueues = new Queue("PRODUCT_SUBPRODUCT_MAP", { connection });
```

**Worker pattern** (`bullmq/worker.js`):
```javascript
const { Worker } = require("bullmq");
const workerOption = { connection: redisConnection, concurrency: 1 };

exports.PMMapWorker = async () => {
  const worker = new Worker("PRODUCT_MATERIAL_MAP", async (job) => {
    await product_material_map(job);  // Heavy logic
  }, workerOption);

  worker.on("completed", (job) => console.log("PRODUCT_MATERIAL_MAP completed"));
  worker.on("failed", (job, err) => console.log("Failed:", err));
};
```

**Controller enqueues job** (`bullmq/Controller.js`):
```javascript
exports.productMaterialMap = async (req, res) => {
  await queue.productMaterialMapQueues.add("PRODUCT_MATERIAL_MAP", req.params);
  res.send("Data is processing in background"); // Immediate response
};
```

**What `product_material_map()` does** (`allModule.logic.js` — 1600+ lines):
1. Fetches product, material, all grades, all equivalent grades, all sub-products
2. Generates **cartesian product** of all combinations:
   - Product x Material x Grade → creates `Grades` records
   - Product x Material x EquivalentGrade → creates `Grades` records
   - SubProduct x Material x Grade → creates `Grades` records
3. **De-duplicates** against existing records
4. **Bulk inserts** new combinations into `Grades` collection
5. Creates `AllModule` records for URL management

**Why BullMQ?** A single product-material mapping can generate 100s-1000s of grade combinations. Processing synchronously would timeout the HTTP request. BullMQ returns immediately and processes in background.

---

## 10. URL Generation & SEO

### Q: How does the system ensure unique supplier URLs?

**A:** A **6-tier cascading fallback** strategy in `lib/utilFunctions.js`:

```javascript
// Tier 1: company name
let url = build_supplier_url(supplier_detail);       // "abc-industries"
let exists = await Users.find({ url });

if (exists.length > 0) {
  // Tier 2: name + country
  url = build_supplier_url_country(supplier_detail);  // "abc-industries-india"
  exists = await Users.find({ url });

  if (exists.length > 0) {
    // Tier 3: name + city
    url = build_supplier_url_city(supplier_detail);   // "abc-industries-mumbai"

    if (exists.length > 0) {
      // Tier 4: name + city + country
      url = build_supplier_url_city_country(supplier_detail);  // "abc-industries-mumbai-india"

      if (exists.length > 0) {
        // Tier 5: contact person name
        url = build_supplier_url_contactName(supplier_detail);  // "abc-industries-john-doe"

        if (exists.length > 0) {
          // Tier 6: contact name + incremental number
          for (let i = 2; i < 100; i++) {
            url = build_supplier_url_contactNameNoInc(supplier_detail, i);
            // "abc-industries-john-doe-2", "abc-industries-john-doe-3", ...
            if ((await Users.find({ url })).length === 0) break;
          }
        }
      }
    }
  }
}
```

**Why this approach?** SEO-friendly URLs are business-critical. The waterfall ensures readable URLs while guaranteeing uniqueness. Most suppliers get Tier 1 or 2; the fallback rarely goes past Tier 4.

---

### Q: What is spintax and how is it used for SEO?

**A:** Spintax generates **randomized title/meta variations** to avoid duplicate content penalties. Found in `modules/admin/allModule/allModuleUtils/utils.js`:

```javascript
// When creating grade combinations, generate varied SEO text
{
  displayName: `${material.name} ${grade.name} ${product.name}`,
  title: spintax(`{Buy|Purchase|Get} {High-Quality|Premium|Top-notch} ${material.name} ${grade.name} ${product.name} | ThePipingMart`),
  meta: spintax(`{Looking to buy|Interested in purchasing} ${material.name} ${grade.name} ${product.name}? ...`)
}
```

**How spintax works:** `{Buy|Purchase|Get}` randomly picks one of "Buy", "Purchase", or "Get" at runtime. This means the same product-grade combination can have different SEO titles, making each page appear unique to search engines.

---

## 11. Search & Pagination

### Q: How is search implemented across multiple collections?

**A:** A **cascading model search** pattern queries 4 collections sequentially:

```javascript
// routes/userRoutes.js — fetchUsersBySearch
let params = {
  $or: [
    { url: { $regex: new RegExp(search, "i") } },
    { name: { $regex: new RegExp(search, "i") } },
    { displayName: { $regex: new RegExp(search, "i") } }
  ]
};

let result = [];

// 1. Search Products first
let product = await Products.aggregate([{ $match: params }, { $limit: 10 }]);
result = [...result, ...product];

// 2. Only search Materials if <10 results
if (result.length < 10) {
  let material = await Materials.aggregate([{ $match: params }, { $limit: 10 }]);
  result = [...result, ...material];
}

// 3. Only search ProductMaterial if still <10
if (result.length < 10) {
  let pm = await ProductMaterial.aggregate([{ $match: params }, { $limit: 10 }]);
  result = [...result, ...pm];
}

// 4. Only search Grades if still <10
if (result.length < 10) {
  let grade = await Grades.aggregate([{ $match: params }, { $limit: 10 }]);
  result = [...result, ...grade];
}
```

**With Redis caching:**
```javascript
let cached = await redisClient.getAsync("search_result_|_" + search);
if (cached) return handleSuccessResponse(JSON.parse(cached), res);
// ... do search ...
await redisClient.setAsync("search_result_|_" + search, JSON.stringify(result), "EX", 300);
```

**Why cascading?** Products are highest priority in search results. Only query less relevant collections if needed. Cache prevents repeated DB hits for the same query.

---

### Q: What pagination patterns are used?

**A:** Three different patterns based on context:

**Pattern 1: Skip-Limit with Count** (most common)
```javascript
const limit = parseInt(req.query?.limit) || 25;
const page = parseInt(req.query?.page) || 1;

let total = await Model.countDocuments(query);
let results = await Model.find(query)
  .sort({ createdAt: -1 })
  .skip((page - 1) * limit)
  .limit(limit);

return { perPage: limit, total, list: results };
```

**Pattern 2: Aggregation Pipeline Pagination** (for complex joins)
```javascript
await Model.aggregate([
  { $match: matchQuery },
  { $lookup: { ... } },
  { $skip: (page - 1) * limit },
  { $limit: limit }
]);
// Separate count query
let total = await Model.aggregate([
  { $match: matchQuery },
  { $count: "total" }
]);
```

**Pattern 3: In-Memory Pagination** (simple lists)
```javascript
let all = await News.find(query).sort({ date: -1 });
let paginated = all.skip((page - 1) * 10).limit(10);
```

---

## 12. RFQ Distribution Algorithm

### Q: How does the RFQ email distribution system work?

**A:** Complex algorithm in `crons/cronJobs.js` — `sendRfqToFreeSuppliers()`:

**Step 1: RFQ Selection** (geographic diversity)
```javascript
// Fetch RFQs from past 7 days
let rfqs = await RFQ.find({ status: true, createdAt: { $gte: sevenDaysAgo } });

// Group by location (country)
let locationGroups = {};
rfqs.forEach(rfq => {
  if (!locationGroups[rfq.location]) locationGroups[rfq.location] = [];
  locationGroups[rfq.location].push(rfq);
});

// Select 10 RFQs: 1 from each unique country first, then fill remaining
let selectedRfqs = [];
let countries = Object.keys(locationGroups);

// Pass 1: One per country (randomized order)
for (let country of shuffle(countries)) {
  if (selectedRfqs.length >= 10) break;
  selectedRfqs.push(locationGroups[country].pop());
}

// Pass 2: Fill remaining from any country
while (selectedRfqs.length < 10 && rfqs.length > 0) {
  selectedRfqs.push(remainingRfqs.pop());
}
```

**Step 2: Supplier Selection & Batch Sending**
```javascript
// Find all eligible free suppliers
const matchQuery = {
  planId: freeSupplierPlanId,
  shouldSendRfqEmail: true,
  active: true,
  isAdmin: false
};

let totalFreeSupplier = await Users.aggregate([
  { $match: matchQuery },
  { $count: "totalFreeSupplier" }
]);

// Send in batches of 20
const batchCount = 20;
const totalBatches = Math.ceil(total / batchCount);

for (let i = 1; i <= totalBatches; i++) {
  const batch = await Users.aggregate([
    { $match: matchQuery },
    { $skip: (i - 1) * batchCount },
    { $limit: batchCount }
  ]);

  for (let supplier of batch) {
    try {
      await sendRawEmail({
        to: supplier.email,
        subject: "Latest RFQs from ThePipingMart",
        html: emailLabel.rfqHtml(selectedRfqs)
      });
      sentCount++;
    } catch (e) {
      failedCount++;
      continue; // Don't stop on individual failure
    }
  }
}
```

**Key design decisions:**
- Geographic diversity ensures suppliers see RFQs from different countries
- Batch processing prevents memory overload with large supplier lists
- Individual error handling means one failed email doesn't stop the entire run
- `shouldSendRfqEmail` flag lets suppliers opt out

---

## 13. Supplier Ranking & Plan-Based Logic

### Q: How are suppliers ranked for email distribution? What is the "gold logic"?

**A:** Suppliers are ranked using a **dynamic scoring formula** based on their plan tier:

```javascript
// The ranking formula: emailCount / (emailLimit * priority)
// Lower score = higher ranking = gets emails first

const goldLogicEmailCount = data.map((e) => {
  const emailCount = e?.emailPlan?.currentEmailSent || 0;
  const emailLimit = e?.planId?.emailLimit || 1;
  const priority = e?.planId?.priority || 1;

  // Formula: normalized email usage adjusted by plan weight
  e.currentEmailSent = emailCount / (emailLimit * priority);
  e.realEmailCount = emailCount; // Preserve original for display
  return e;
});

// Sort: suppliers who've sent fewer (relative to their plan) get priority
let sortedData = allData.sort((a, b) =>
  a.currentEmailSent > b.currentEmailSent ? 1 : -1
);
```

**How it works by plan:**
| Plan | emailLimit | priority | If sent 50 emails | Score |
|------|-----------|----------|-------------------|-------|
| Free | 100 | 1 | 50 / (100 * 1) = 0.50 | Higher score = lower rank |
| Gold | 500 | 3 | 50 / (500 * 3) = 0.033 | Lower score = higher rank |
| Platinum | 1000 | 5 | 50 / (1000 * 5) = 0.01 | Lowest score = top rank |

**Result:** Platinum/Gold suppliers naturally rank higher because their higher limit and priority produce lower scores. A free supplier who sent 50 emails scores 0.50 while a Platinum supplier who sent 50 scores only 0.01.

---

### Q: What are "Hot Products" and how do they affect distribution?

**A:** Hot Products are **premium product placements** where suppliers get guaranteed email slots:

```javascript
// 1. Fetch hot product suppliers (separate pool)
let hotProductSupplier = await HotProductSuppliers.aggregate([...pipeline...]);

// 2. Remove hot product suppliers from regular pool (prevent double-counting)
for (let hp of hotProductSupplier) {
  const idx = regularSuppliers.findIndex(e => e.email === hp.userId.email);
  if (idx !== -1) regularSuppliers.splice(idx, 1);
}

// 3. Allocate: hot products fill first, regular suppliers fill remaining
if (count) {
  hotProductSupplier = hotProductSupplier.slice(0, count);
  let remaining = count - hotProductSupplier.length;
  regularSuppliers = regularSuppliers.slice(0, remaining);
}

// 4. Merge: hot products marked specially
for (let hp of hotProductSupplier) {
  regularSuppliers.push({ ...hp.userId, isHotProduct: true });
}
```

**Flow:** If admin says "send to 10 suppliers" and there are 3 hot product suppliers, those 3 get guaranteed slots and the remaining 7 come from the regular ranked pool.

---

## 14. Error Handling & Response Patterns

### Q: What is the standard error/success response format?

**A:** Centralized in `lib/utilFunctions.js` and `helper/response.js`:

**Success response:**
```javascript
handleSuccessResponse(data, res, total) {
  return res.status(200).json({ message: 'success', data, total }).end();
}

// Admin modules use:
generateJsonResponse(data, httpStatus.OK, ResponseMsg.gradeDetail)
// Returns: { status: 200, message: "Grade detail...", data: {...} }
```

**Error responses** — different helpers for different scenarios:
```javascript
handleMissingField(fieldName, res)      // 400 — "missing: fieldName"
handleInvalidValue(message, res)        // 400 — validation failure
handleDBError(error, res)               // 503 — database error
handleConflictError(message, res)       // 409 — duplicate/conflict
handleLimitExceed(message, res)         // 400 — plan limit hit
handleNullValueReturnFromDB(msg, res)   // 200 with status: 0 — no data found
handleError(message, res)               // 503 — generic server error
```

**Pattern in controllers:**
```javascript
try {
  let data = await SomeModel.find(query);
  if (!data) return handleNullValueReturnFromDB("Not found", res);
  return handleSuccessResponse(data, res);
} catch (e) {
  console.log(e);
  Notifier.notifyTeams(e, "context for debugging");
  return handleDBError(e, res);
}
```

---

## 15. Middleware Design

### Q: What is the Express middleware chain order?

**A:** Defined in `app.js`, the middleware executes in this order:

```
1. compression()              — gzip compression (level 6)
2. express.static("uploads")  — serve uploaded files
3. cors(corsOptions)          — whitelist-based CORS
4. morgan(logger.stream)      — HTTP request logging
5. express.json()             — parse JSON bodies
6. bodyParser.urlencoded()    — parse form data
7. cookieParser()             — parse cookies
8. session(redisStore)        — Redis-backed sessions
9. Manual CORS headers        — Access-Control headers
10. timeout(50000)            — 50-second request timeout
11. requestLogger             — Custom Winston logging
12. API routes                — /auth, /product, /supplier, /notify, /api/v1/admin
```

**Key detail:** CORS whitelist includes:
```javascript
const whitelist = [
  "http://localhost:4200", "http://localhost:4000",
  "https://www.thepipingmart.com", "https://admin.thepipingmart.com",
  "https://api.thepipingmart.com", ...
];
```

---

### Q: How does the `fetchSession` middleware differ from `authoriseUser`?

**A:** `fetchSession` is an **optional auth middleware** — it loads the user if a token is present but doesn't block the request if missing:

```javascript
// authoriseUser — BLOCKS if no auth
const authoriseUser = (req, res, next) => {
  if (!req.headers.auth) return res.status(401).json({ message: "Please login" });
  // ... fetch from Redis, attach req.user, or return 401
};

// fetchSession — OPTIONAL, doesn't block
const fetchSession = (req, res, next) => {
  if (!req.headers.auth) return next(); // Continue without user
  redisClient.get(req.headers.auth, (err, data) => {
    if (data) req.user = JSON.parse(data);
    next(); // Always continue
  });
};
```

**Use case:** Public pages that optionally personalize content if user is logged in (e.g., showing "Welcome back, Supplier X" on product pages).

---

## 16. Socket.io — Real-Time Events

### Q: How is real-time communication implemented?

**A:** Socket.io is initialized in `config/socket.js` and used for supplier signup notifications:

```javascript
// config/socket.js
const { Server } = require('socket.io');
let io;

const connectSocket = (server) => {
  io = new Server(server, {
    cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
  });
};

const myEventHandler = (event, data) => {
  io.emit(event, data); // Broadcast to all connected clients
};
```

**Used in signup flow** (`routes/userRoutes.js`):
```javascript
// After successful supplier registration
myEventHandler("supplier_signup", user);
```

**Also used for unregistered user alerts:**
```javascript
// In cron job — notifyAdminUnregisteredUser
myEventHandler("unverified_users", unregisteredUsers);
```

The admin dashboard listens for these events to show real-time notifications when new suppliers register.

---

## 17. Data Migration

### Q: How are data migrations handled?

**A:** `helper/db-migration.js` contains migration scripts for transforming legacy data:

**Email Migration Example:**
```javascript
const migrateEmails = async () => {
  let oldEmails = await AllEmailsModel.find({});

  for (let old of oldEmails) {
    let newEmail = new Emails({
      senderEmail: old.fromEmail,
      receiverEmail: old.toEmail,
      emailType: mapOldTypeToNew(old.type),
      status: mapOldStatusToNew(old.status),
      emailContent: {
        subject: old.subject,
        html: old.body,
        attachments: old.attachments
      },
      senderDetails: {
        name: old.senderName,
        email: old.senderEmail,
        mobileNo: old.senderPhone,
        country: old.senderCountry
      },
      productInfo: {
        productId: old.productId,
        materialId: old.materialId,
        gradeId: old.gradeId
      }
    });
    await newEmail.save();
  }
};
```

**Key pattern:** Reads from old schema, transforms data to new schema format, writes to new collection. No in-place modification — migration creates new records.

---

## 18. Security Considerations

### Q: What security measures exist? What are the gaps?

**A: Measures implemented:**

1. **Bcrypt password hashing** — Salt rounds: 12 (`Constant.USER_AUTH_MODEL.SALT_HASH_LENGTH`)
2. **Redis session management** — Tokens expire after 30 days
3. **IP/Email blocking** — Redis list for spam prevention
4. **CORS whitelist** — Only allowed origins can make requests
5. **Multer file size limits** — Controlled upload sizes
6. **Input validation** — `express-validator` in admin modules

**Gaps and areas for improvement:**

1. **Hardcoded AWS credentials** in `config/config.js` — should use environment variables or IAM roles
2. **Weak session secret** — `"pipe"` is too simple, should be a long random string
3. **No rate limiting** — No express-rate-limit or similar middleware
4. **No CSRF protection** — Session-based auth without CSRF tokens
5. **Custom auth header** — Uses `auth` instead of standard `Authorization: Bearer`
6. **No input sanitization** — Raw regex from user input in search queries could enable ReDoS
7. **Console.log in production** — Sensitive data may leak to logs
8. **No helmet.js** — Missing security headers (X-XSS-Protection, HSTS, etc.)

---

## 19. Environment & Configuration Management

### Q: How does environment switching work between local, staging, and production?

**A:** **Comment-based switching** — URLs are hardcoded and toggled by commenting/uncommenting blocks:

```javascript
// config/config.js
//? use for local
exports.host_address = "http://localhost:3000/";
exports.backend_api = "http://localhost:3050/";
exports.MONGODB_ADDRESS = "mongodb://127.0.0.1:27017/pipingmart";

//? use for staging (COMMENTED OUT)
// exports.host_address = "https://pipingmart.co.in/";
// exports.MONGODB_ADDRESS = "mongodb+srv://...staging.../pipingmartDev";

//? use for live (COMMENTED OUT)
// exports.host_address = "https://www.thepipingmart.com/";
// exports.MONGODB_ADDRESS = "mongodb+srv://...production.../pipingmart";
```

**Known .env variables** (loaded via `dotenv`):
```
NODE_ENV          — "development" or "production"
RUN_CRON          — "false" to disable cron jobs
INFO_LOG_PATH     — Custom Winston log path
IMAGE_BASE_URL    — CloudFront CDN URL for images
NO_REPLY_EMAIL    — Sender email for SES
SUPPORT_EMAIL     — Support team email
PER_PAGE          — Default pagination size
```

**Problem:** No proper environment variable system for URLs/DB. Developers must manually comment/uncomment config blocks, which is error-prone.

---

## 20. Design Patterns Used

### Q: Summarize the key design patterns used across this codebase.

**A:**

| Pattern | Where Used | Example |
|---------|------------|---------|
| **MVC + Service Layer** | `modules/admin/` | Controller → Service → Model separation |
| **Middleware Chain** | `app.js`, routes | `[authoriseUser, onlyAdmin, handler]` |
| **Repository (implicit)** | Models | `CONN_TO_DB.model()` as data access |
| **Factory** | URL generation | `build_supplier_url()` variations |
| **Strategy** | Supplier ranking | Different scoring formulas per plan tier |
| **Observer** | Socket.io events | `myEventHandler("supplier_signup", data)` |
| **Producer-Consumer** | BullMQ | Controller enqueues → Worker processes |
| **Template Method** | Cron jobs | Same structure, different business logic |
| **Facade** | `pipingmart.service.ts` | Single `sendRequest()` wraps all HTTP methods |
| **Singleton** | Redis/DB connections | One shared connection instance |
| **Cascading Fallback** | URL uniqueness | 6-tier supplier URL generation |
| **Cache-Aside** | Redis search caching | Check cache → miss → query DB → store in cache |
| **Soft Delete** | All admin modules | `deletedAt: null` instead of `DELETE` |
| **Builder** | Email construction | `generateRawMailData()` assembles MIME email |
| **Batch Processing** | RFQ distribution | Process 20 suppliers per batch |

---

## 21. Express.js Deep Dive — Middleware Stack

### Q: What is the exact middleware execution order in `app.js`? Walk through each middleware.

**A:** The middleware stack executes in this precise order (every incoming request passes through each):

```
1.  compression()              — gzip (level 6, threshold 0, x-no-compression header check)
2.  express.static("uploads")  — serve uploaded files at root URL
3.  AWS SNS content-type fix   — forces JSON content-type for SNS webhook messages
4.  cors(whiteListedDomains)   — whitelist-based CORS
5.  morgan("dev")              — HTTP request logging → streams to Winston
6.  EJS view engine setup      — for error page rendering
7.  express.json()             — parse JSON bodies (default 100kb limit)
8.  requestLogger              — custom Winston debug logger (headers, method, path, body)
9.  express.urlencoded()       — parse URL-encoded bodies
10. bodyParser.json()          — REDUNDANT — duplicate of #7
11. bodyParser.urlencoded()    — REDUNDANT — duplicate of #9
12. cookieParser()             — parse cookies (no signing secret)
13. compression()              — REDUNDANT — duplicate of #1
14. express-session            — Redis-backed sessions (secret: "pipe", TTL: 260s)
15. Manual CORS headers        — sets Access-Control-Allow-Origin: * (OVERRIDES #4!)
16. connect-timeout(50000)     — 50-second request timeout
17. Static /assets             — serves productPage/assets/
18. Static /public             — serves public/
19. API routes                 — /auth, /product, /supplier, /notify, /api/v1/admin
20. 404 handler                — content-negotiated "Not found"
21. Error handler (4-arg)      — renders views/error.ejs, logs via Winston
```

**Key files:** `app.js` (lines 32–295)

---

### Q: What bugs exist in the middleware stack? Explain the CORS contradiction.

**A:** Three middleware bugs:

**Bug 1: CORS Contradiction** — `cors()` whitelist at step 4 correctly restricts origins, but step 15 sets `Access-Control-Allow-Origin: *` which **overrides** the whitelist for all requests:
```javascript
// Step 4 — whitelist (correct)
app.use(cors({ origin: ["http://localhost:4200", "https://www.thepipingmart.com", ...] }));

// Step 15 — wildcard override (BREAKS the whitelist)
app.use(function (req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");  // Allows ANY origin
  next();
});
```

**Bug 2: Duplicate Body Parsing** — Both `express.json()` and `bodyParser.json()` are registered. Since Express 4.16+, `express.json` IS body-parser under the hood, so JSON bodies are parsed twice.

**Bug 3: Duplicate Compression** — `compression()` is registered at both step 1 and step 13. The second registration compresses already-compressed responses (negligible impact but wasteful).

**Key file:** `app.js` (lines 140, 151, 154, 159, 179–192)

---

### Q: How does `express-group-routes` work? How are admin routes organized?

**A:** `express-group-routes` (v1.1.0) patches `app.group()` onto the Express prototype as a side effect:

```javascript
// app.js line 1 — global side-effect import
require("express-group-routes");

// app.js lines 239–255 — groups 15 admin sub-routers under one prefix
app.group("/api/v1/admin", (router) => {
  router.use("/email", emailRouter);
  router.use("/material", materialRouter);
  router.use("/material-grade", materialGradeRouter);
  router.use("/grade-model", gradeRouter);
  router.use("/equivalent-grade", equivalentGradeRouter);
  router.use("/material-sub-product-product", materialSubProductProductRouter);
  router.use("/dashboard", dashboardRouter);
  router.use("/plan", planRouter);
  router.use("/user", userRouter);
  router.use("/allModule", allModuleRouter);
  router.use("/rfq", RfqRouter);
  router.use("/blockEmail", blockEmailRoute);
  router.use("/blockIp", ipAddressRoute);
  router.use("/freeSupplier", listFreeSupplerRouter);
  router.use("/sendRfqEmail", rfqEmailStatusRouter);
});
```

**Result:** All admin APIs live under `/api/v1/admin/*`. For example, `POST /api/v1/admin/email/create` hits the email module's create controller.

**Why this pattern?** Avoids repeating the `/api/v1/admin` prefix 15 times. Each sub-router handles its own auth middleware internally.

---

### Q: How does the `connect-timeout` middleware work? Is it correctly implemented here?

**A:** `connect-timeout` sets a deadline on each request:

```javascript
// app.js line 193
const timeout = require("connect-timeout");
app.use(timeout(Constant.DEFAULT_API_CALL_TIMEOUT)); // 50000ms = 50 seconds
```

After 50 seconds, `req.timedout` becomes `true` and the request emits a timeout event.

**Problem:** No `haltOnTimedout` middleware is registered. The official docs recommend:
```javascript
// MISSING — should exist after routes
function haltOnTimedout(req, res, next) {
  if (!req.timedout) next();
}
```

Without this, timed-out requests continue executing their handler, and if the handler tries to send a response after timeout, it throws `ERR_HTTP_HEADERS_SENT`.

**Key file:** `app.js` line 193, `lib/Constant.js` → `DEFAULT_API_CALL_TIMEOUT: 50000`

---

### Q: How does the Express error handling middleware work?

**A:** Two error handlers exist:

**Handler 1: 404 (3-arg middleware)** — catches unmatched routes:
```javascript
// app.js lines 264–281
app.use(function (req, res, next) {
  logger.error("Middleware@unknownEndpoint");
  res.status(404);
  if (req.accepts("html")) return res.send({ error: "Invalid routes " });
  if (req.accepts("json")) return res.send({ error: "Not found" });
  res.type("txt").send("Not found");
});
```
Content-negotiated response based on `Accept` header.

**Handler 2: Error (4-arg middleware)** — catches `next(err)` from controllers:
```javascript
// app.js lines 284–295
app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};
  logger.error(`${err.status || 500} - ${res.statusMessage} ${err.message}`);
  res.status(err.status || 500);
  res.render("error"); // renders views/error.ejs
});
```
Stack trace only shown in development. Renders an EJS error page.

**Process-level handlers** (`app.js` lines 119–129):
```javascript
process.on("uncaughtException", (err) => Notifier.notifyTeams(err, "Error From backend api"));
process.on("SIGINT", () => process.exit(0));
// NOTE: No process.on("unhandledRejection") — silently swallowed in Node >= 15
```

**Key insight:** The `Middleware.util.js` file defines another `errorHandler` function but it's **never registered** in `app.js` — dead code.

---

## 22. Node.js Core Concepts in This Project

### Q: How does this project handle the Node.js event loop? What blocks it?

**A:** Several patterns in this codebase **block the event loop**:

**1. Synchronous bcrypt** — blocks during password hashing:
```javascript
// models/Users.js
userSchema.static('hashPassword', function (password) {
  return Bcrypt.hashSync(password, Bcrypt.genSaltSync(12));
  // Salt rounds = 12 → ~300ms blocking per hash operation
});

userSchema.methods.comparePassword = (password, hash) => {
  return Bcrypt.compareSync(password, hash); // Blocks during every login
};
```
**Fix:** Use `await Bcrypt.hash(password, 12)` and `await Bcrypt.compare(password, hash)`.

**2. Synchronous file I/O** — blocks during uploads:
```javascript
// helper/uploadToS3.js
Body: await fs.readFileSync(imagePath), // readFileSync is sync, "await" is meaningless
// Loads ENTIRE file into memory synchronously

// routes/userRoutes.js
const fileContent = fs.readFileSync(req.file.path); // Same pattern
```
**Fix:** Use `await fs.promises.readFile(imagePath)`.

**3. Synchronous file writes in sitemap generation:**
```javascript
// crons/site_map_code.js
await fs.writeFileSync(path.join(__dirname + out), xmlString);
// writeFileSync blocks — should use fs.promises.writeFile
```

**Key takeaway:** The codebase uses synchronous versions of bcrypt, fs.readFileSync, and fs.writeFileSync in request handlers, which blocks the event loop and prevents Node from handling other requests.

---

### Q: Explain the async patterns used in this codebase. What's the `new Promise(async ...)` anti-pattern?

**A:** Three async patterns coexist:

**Pattern 1: Callbacks (oldest code)**
```javascript
// routes/userRoutes.js:360–428 — login flow
Users.findOne({ email }, (err, docs) => {
  if (docs.comparePassword(password, docs.password)) {
    saveSessionDetails(req.sessionID, userData)
      .then(() => res.status(200).json({ user: userData }))
      .catch((e) => console.log(e));
  }
});
```

**Pattern 2: async/await (newer code)**
```javascript
// modules/admin/grade/services/list.js
const list = async (req, res, next) => {
  try {
    const data = await GradeModel.find(query, null, option);
    return res.send(generateJsonResponse(data, 200, "Success"));
  } catch (error) {
    return next(error);
  }
};
```

**Pattern 3: `new Promise(async ...)` anti-pattern (in several files)**
```javascript
// helper/uploadToS3.js — ANTI-PATTERN
exports.uploadToS3 = async (fileName, imagePath, path) => {
  return new Promise(async (resolve, reject) => {
    try {
      // If this throws AFTER the promise is resolved/rejected,
      // the error is silently swallowed
      sharp(imagePath).toFile(`...`).then(...).catch(...);
      S3.upload(params, function (error, data) {
        if (error) reject(error);
        else resolve({ aws_out: data });
      });
    } catch (e) { reject(e); }
  });
};
```

**Why it's bad:** The `new Promise(async (resolve, reject) => { ... })` pattern means:
1. If an unhandled error occurs inside, the Promise hangs forever (neither resolves nor rejects)
2. Mixing `async/await` with `new Promise` is unnecessary — just use `async/await` directly
3. Found in: `helper/uploadToS3.js`, `lib/Notifier.js`, `routes/rendered_page_methods.js`

---

### Q: What process-level error handling exists? What's missing?

**A:** The main server (`app.js`) registers:

```javascript
process.on("error", (err) => {
  Notifier.notifyTeams(err, "Error From backend api");
});

process.on("uncaughtException", (err) => {
  Notifier.notifyTeams(err, "Error From backend api");
  // NOTE: Does NOT exit the process — state may be corrupted
});

process.on("SIGINT", () => process.exit(0)); // Hard exit, no cleanup
```

**What's missing:**
1. **`unhandledRejection`** handler — not registered in main app (silently swallowed in Node >= 15)
2. **`SIGTERM`** handler — no graceful shutdown for production deployments
3. **Process restart after uncaughtException** — Node docs recommend exiting after uncaught exception because state is undefined

The product page server (`productPage/product.js`) DOES register `unhandledRejection` but the main API does not.

**Key file:** `app.js` lines 119–129

---

## 23. Input Validation (express-validator)

### Q: How is input validation implemented? What pattern do the admin modules follow?

**A:** Admin modules use `express-validator` with a **switch-case pattern**:

```javascript
// modules/admin/grade/validations/grade.js
const { check, body } = require("express-validator");

exports.validate = (method) => {
  switch (method) {
    case validationConst.grade.create: {
      return [
        body("gradeName")
          .notEmpty()
          .withMessage({ message: "Grade name is required", status: 400 }),
        body("gradeModelId")
          .optional({ checkFalsy: true, nullable: true }),
        check(["materialId", "gradeModelId"])
          .custom(async (value, { req }) => {
            // Async DB lookup — check if combination already exists
            const existing = await MaterialGrade.findOne({
              materialId: req.body.materialId,
              gradeModelId: req.body.gradeModelId,
              deletedAt: null
            });
            if (existing) return Promise.reject({ message: "Already exists", status: 409 });
          })
      ];
    }
    default:
  }
};
```

**Controller consumes validation result:**
```javascript
// modules/admin/grade/controllers/grade.js
exports.create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(errors.array()[0].msg.status).json({
        data: errors.array(),
        statusCode: errors.array()[0].msg.status,
        responseMessage: errors.array()[0].msg.message,
      });
    }
    return gradeService.create(req, res, next);
  } catch (err) {
    return next(err);
  }
};
```

**Route wiring:**
```javascript
// modules/admin/grade/routes/grade.js
router.post("/create",
  authoriseUser, onlyAdmin,          // auth middleware
  rules.validate(validationConst.grade.create),  // validation array
  controller.create                   // controller
);
```

**Modules WITH validation:** email, grade, material-grade, dashboard, plan, user
**Modules WITHOUT validation:** blockEmail, IpAddress, allModule, Rfqs, equivalent-grade, shouldSendRfqEmail

**Key files:** `modules/admin/*/validations/*.js`

---

### Q: What validation techniques does this project use?

**A:** Five distinct techniques:

| Technique | Example | Used For |
|-----------|---------|----------|
| **Required field** | `body("name").notEmpty().withMessage({...})` | All create operations |
| **Optional field** | `body("logo").optional({ checkFalsy: true, nullable: true })` | Update operations |
| **Async DB check** | `.custom(async (value) => { await Model.findOne(...) })` | Duplicate prevention |
| **Case-insensitive match** | `{ $regex: new RegExp("^" + value + "$", "i") }` | Name uniqueness check |
| **Cross-field validation** | `check(["field1", "field2"]).custom(...)` | Compound uniqueness (e.g., material+grade combo) |

**Missing validation patterns:**
- No length limits on text fields (title, description, review content)
- No file type validation on multer uploads
- No regex pattern validation on emails or phone numbers
- Top-level routes (`routes/userRoutes.js`, `routes/emailLogic.js`) have **no express-validator** at all — only admin modules use it

---

## 24. Logging Architecture (Winston + Morgan)

### Q: How is logging configured? What are the different log levels?

**A:** Two logging systems work together:

**Winston** (`config/LoggerConfig.js`) — structured application logging:
```javascript
const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };

const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'info';
};

const logger = new winston.createLogger({
  level: level(),
  levels,
  format: winston.format.combine(
    winston.format.timestamp({ format: "MMM-DD-YYYY HH:mm:ss" }),
    winston.format.printf((info) =>
      `${info.level}: ${[info.timestamp]}: ${info.message} `
    )
  ),
  transports: [
    new winston.transports.File({
      filename: process.env.INFO_LOG_PATH || `${appRoot}/log/app.info.log`,
      maxsize: 5242880,  // 5MB per file
      maxFiles: 5,       // 5 rotating files = 25MB max
      handleExceptions: true,
      json: true
    }),
    new winston.transports.Console() // options.console is undefined — uses defaults
  ],
  exitOnError: false,
});
```

**Morgan** (`app.js`) — HTTP request logging:
```javascript
app.use(MorgonLogger("dev", {
  stream: winston.stream,  // Routes to Winston via logger.http()
}));

// Winston bridge:
logger.stream = { write: (message) => logger.http(message) };
```

**Log level filtering by environment:**
| Level | Development | Production |
|-------|------------|------------|
| error (0) | Logged | Logged |
| warn (1) | Logged | Logged |
| info (2) | Logged | Logged |
| http (3) | Logged | **Suppressed** |
| debug (4) | Logged | **Suppressed** |

**Custom request logger** (`lib/Middleware.util.js`):
```javascript
const requestLogger = (req, res, next) => {
  logger.debug(req.headers);    // Only in development
  logger.debug(`Method: ${req.method}`);
  logger.debug(`Path: ${req.path}`);
  logger.debug(req.body);       // Logs full request body!
  next();
};
```

**Warning:** In development, `requestLogger` logs the full request body including passwords and sensitive data at `debug` level. This is suppressed in production since `info` level filters out `debug`.

**Key files:** `config/LoggerConfig.js`, `app.js` lines 141–148, `lib/Middleware.util.js`

---

## 25. Rate Limiting & IP Blocking System

### Q: How does IP-based rate limiting work? Is there express-rate-limit?

**A:** There is **no `express-rate-limit`** package. Instead, a custom Redis-based IP blocking system exists:

**Architecture:**
```
Incoming Request → Check Redis IP counter → Under limit? → Proceed
                                           → Over limit? → Block IP in DB → Reject
```

**Models** (`models/BlockEmailAndIp.js`):
- `blockEmailModel` — blocks by email address or domain (`blockType: "email" | "domain"`)
- `blockIpModel` — blocks IP addresses (temporary or permanent)
- `limitAndDurationModel` — configurable rate limit threshold and duration window

**Rate limiting logic** (`modules/admin/email/services/checkBlockEmailsAndIps.js`):
```javascript
// 1. Check if IP is permanently or temporarily blocked in DB
const blocked = await blockIpModel.findOne({ ipAddress });
if (blocked) return "blocked";

// 2. Check Redis counter for IP
const counter = await redisClient.getAsync(`IP:${ipAddress}`);

if (!counter) {
  // First request — start counting
  await redisClient.setAsync(`IP:${ipAddress}`, 1, 'EX', limitAndDuration.duration);
} else if (parseInt(counter) >= limitAndDuration.limit) {
  // Threshold exceeded — create permanent block in DB
  await blockIpModel.create({ ipAddress, blockType: "permanentBlock" });
  return "blocked";
} else {
  // Under limit — increment counter
  await redisClient.incr(`IP:${ipAddress}`);
}
```

**Email/Domain blocking:**
```javascript
// Checks domain first (e.g., block all @spam.com), then specific email
const checkTemporaryBlockAndPermanentBlockForEmail = async (emailId) => {
  const domain = emailId.split('@')[1];
  const domainBlocked = await blockEmailModel.findOne({ email: domain, blockType: "domain" });
  if (domainBlocked) return "blocked";

  const emailBlocked = await blockEmailModel.findOne({ email: emailId, blockType: "email" });
  if (emailBlocked) return "blocked";
  return "notBlocked";
};
```

**Admin endpoints:**
| Endpoint | Action |
|----------|--------|
| `GET /api/v1/admin/blockEmail/list` | List blocked emails/domains |
| `POST /api/v1/admin/blockEmail/add` | Add email/domain block |
| `GET /api/v1/admin/blockIp/list` | List blocked IPs |
| `POST /api/v1/admin/blockIp/add` | Add IP block |
| `GET /api/v1/admin/blockIp/getLmitAndDuration` | Get rate limit settings |
| `PUT /api/v1/admin/blockIp/setLmitAndDuration/:id` | Update rate limit settings |

**Applied only to:** Email enquiry endpoints (`routes/emailLogic.js`). Not applied to auth, product, or admin routes.

**Key files:** `modules/admin/email/services/checkBlockEmailsAndIps.js`, `models/BlockEmailAndIp.js`, `routes/emailLogic.js`

---

## 26. Image Processing Pipeline (Sharp + S3)

### Q: How does the file upload pipeline work? What bugs exist in `uploadToS3.js`?

**A:** Three-stage pipeline: Client → Multer (disk) → Sharp (WebP) → S3 (cloud). But the implementation has **critical bugs**:

```javascript
// helper/uploadToS3.js — BUGGY implementation
exports.uploadToS3 = async (fileName, imagePath, path) => {
  return new Promise(async (resolve, reject) => {  // Anti-pattern #1
    try {
      const newFile = `${fileName?.replace(/[\W_]+|\s+/g, '-')}-${Date.now()}.webp`;

      // BUG #1: Sharp conversion is NOT awaited — runs in parallel with S3 upload
      sharp(imagePath)
        .toFile(`uploads/S3/${newFile}`)
        .then(data => console.log("image converted successfully"))
        .catch(err => console.log("error at convert image"));

      // BUG #2: Reads the ORIGINAL file, not the WebP conversion
      S3.upload({
        Body: await fs.readFileSync(imagePath),  // BUG #3: readFileSync is sync, await is useless
        Key: `${path}${newFile}`,                // Key says .webp but body is original format
        Bucket: "pipingmartassets"
      }, function (error, data) {
        if (error) reject(error);
        else resolve({ aws_out: data });
      });
    } catch (e) { reject(e); }
  });
};
```

**Five bugs identified:**
1. **Sharp not awaited** — S3 upload starts before WebP conversion finishes
2. **Wrong file uploaded** — `fs.readFileSync(imagePath)` reads the original, not the `.webp`
3. **`await fs.readFileSync`** — `readFileSync` is synchronous, `await` does nothing
4. **`new Promise(async ...)`** — anti-pattern that can silently swallow errors
5. **No temp file cleanup** — converted WebP file accumulates on disk

**Correct implementation would be:**
```javascript
exports.uploadToS3 = async (fileName, imagePath, s3Path) => {
  const newFile = `${fileName.replace(/[\W_]+|\s+/g, '-')}-${Date.now()}.webp`;
  const outputPath = `uploads/S3/${newFile}`;

  // 1. Convert to WebP FIRST
  await sharp(imagePath).webp().toFile(outputPath);

  // 2. Read the CONVERTED file
  const fileContent = await fs.promises.readFile(outputPath);

  // 3. Upload to S3
  const data = await S3.upload({
    Body: fileContent, Key: `${s3Path}${newFile}`, Bucket: "pipingmartassets"
  }).promise();

  // 4. Cleanup
  await fs.promises.unlink(imagePath);
  await fs.promises.unlink(outputPath);

  return { aws_out: data };
};
```

**Multer configuration** — no file type validation or size limits:
```javascript
// routes/userRoutes.js
const upload = multer({ dest: "uploads/" });           // No limits
const newsUpload = multer({ storage: diskStorage });   // No limits, no fileFilter
```

**Key files:** `helper/uploadToS3.js`, `routes/userRoutes.js` lines 6–59

---

## 27. Sitemap Generation System

### Q: How are XML sitemaps generated? What is the N+1 problem in sitemap code?

**A:** Three sitemap crons run nightly at staggered times:

| Cron | Schedule | Sitemap |
|------|----------|---------|
| `update_product_site_map` | Midnight | Product URLs |
| `update_product_grade_sitemap` | 1:00 AM | Grade URLs per product |
| `update_material_site_map` | 2:00 AM | Material URLs |

**The N+1 problem** in `crons/site_map_code.js`:
```javascript
async function collect_urls(only_product = false) {
  // Query 1: Fetch ALL products
  let product_urls = await Products.find({}, { url: 1, code: 1, productId: 1 });

  for (let i = 0; i < product_urls.length; ++i) {
    // Query N: One query PER product — classic N+1!
    let grade = await Grades.find(
      { productId: d.productId, active: true },
      { url: 1, code: 1 }
    );
    // Build XML entries from grades
  }
}
```

If there are 100 products, this fires **101 queries** (1 for products + 100 for grades).

**Additional issue — `collect_urls()` called twice:**
`update_product_site_map` calls `collect_urls(true)` at midnight, then `update_product_grade_sitemap` calls `collect_urls()` at 1 AM. Both re-fetch all products and grades from DB.

**File write uses synchronous I/O:**
```javascript
await fs.writeFileSync(path.join(__dirname + out), xmlString);
// writeFileSync blocks the event loop — should use fs.promises.writeFile
```

**Fix:** Use a single aggregation with `$lookup` to join products and grades in one query:
```javascript
const data = await Products.aggregate([
  { $lookup: { from: "grades", localField: "productId", foreignField: "productId", as: "grades" } }
]);
```

**Key file:** `crons/site_map_code.js`

---

## 28. Process Management & Health

### Q: Is there graceful shutdown? Are there health check endpoints?

**A:** **No graceful shutdown** and **no health check endpoints** exist in this codebase.

**Current server startup** (`webServers/pipingMart.js`):
```javascript
const server = http.createServer(app);
server.on('error', onError);       // Handles EACCES, EADDRINUSE
server.on('listening', onListening);

function onError(error) {
  switch (error.code) {
    case 'EACCES': process.exit(1); break;
    case 'EADDRINUSE': process.exit(1); break;
    default: throw error;
  }
}
```

**Current process handlers** (`app.js`):
```javascript
process.on("SIGINT", () => process.exit(0));  // Hard exit, no cleanup
// No SIGTERM handler — container orchestrators send SIGTERM first
```

**What's missing for production:**
```javascript
// 1. Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// 2. Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    // Close DB connections
    CONN_TO_DB.close();
    redisClient.quit();
    process.exit(0);
  });
  // Force close after 30s
  setTimeout(() => process.exit(1), 30000);
});
```

**CLAUDE.md mentions** a `server-production.js` with a `/health` endpoint and graceful shutdown, but this file does **not exist** in the staging codebase. It likely exists only in the production deployment.

**Key files:** `webServers/pipingMart.js`, `app.js` lines 119–129

---

---

# Section B: Backend Optimizations & Improvements

---

## PART 1: Optimizations Already Done

### OPT-1: Gzip Compression
**What:** `compression()` middleware compresses all responses at level 6.
**Where:** `app.js` line 32
```javascript
app.use(compression({
  level: 6,
  threshold: 0,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
```
**Impact:** Reduces response payload size by 60–80% for JSON and HTML responses.

---

### OPT-2: Redis Multi-Layer Caching (10+ cache types)
**What:** Redis caches data at multiple levels to reduce DB load.
**Where:** Throughout codebase

| Cache Key | TTL | Data Cached |
|-----------|-----|-------------|
| Session tokens | 30 days | User session data |
| OTP codes | 5 min | Phone/email OTP |
| `search_result_\|_*` | 5 min | Search results across 4 collections |
| `cached_home_page_product_data` | varies | Homepage products |
| `cached_home_page_top_bar_data` | varies | Top bar data |
| `grade_id_array` | varies | Grade ID lookups |
| `product_id_array` | varies | Product ID lookups |
| `sub_products_details_*` | varies | Sub-product data |
| `blog_downloaded` | varies | Blog post cache |
| `prev_supplier_shown_details` | 2 min | Supplier rotation |
| `homepage_rfq_data` | 60 sec | Homepage RFQ listings |
| `IP:*` | configurable | Rate limit counters |

---

### OPT-3: BullMQ for Heavy Background Operations
**What:** Cartesian product generation (product × material × grade combinations) offloaded to background workers.
**Where:** `modules/admin/allModule/bullmq/`
**Impact:** HTTP request returns immediately instead of blocking for potentially minutes of processing.

---

### OPT-4: Cascading Search with Early Exit
**What:** Search queries 4 collections (Products → Materials → ProductMaterial → Grades) but stops early once 10 results are found.
**Where:** `routes/userRoutes.js` — `fetchUsersBySearch`
```javascript
let result = [];
let product = await Products.aggregate([{ $match: params }, { $limit: 10 }]);
result = [...result, ...product];
if (result.length < 10) { /* search materials */ }
if (result.length < 10) { /* search productMaterial */ }
if (result.length < 10) { /* search grades */ }
```
**Impact:** Avoids unnecessary DB queries when products already satisfy the search.

---

### OPT-5: `$facet` for Batch Collection Queries
**What:** Fetches materials for ALL products in a single DB call using `$facet`.
**Where:** `routes/productCategoryGradesRoutes.js`
**Impact:** Replaces N separate queries (one per product) with 1 aggregation.

---

### OPT-6: Batch Email Sending (20 per batch)
**What:** RFQ distribution processes suppliers in batches of 20 with individual error handling.
**Where:** `crons/cronJobs.js` — `sendRfqToFreeSuppliers()`
**Impact:** Prevents memory overload with large supplier lists; one failed email doesn't stop the batch.

---

### OPT-7: Image WebP Conversion via Sharp
**What:** All uploaded images converted to WebP format before S3 upload.
**Where:** `helper/uploadToS3.js`
**Impact:** WebP is 25–35% smaller than JPEG at same quality — reduces CDN bandwidth costs.

---

### OPT-8: Supplier Ranking Formula
**What:** Dynamic scoring prevents email spam: `score = emailsSent / (emailLimit × planPriority)`.
**Where:** `routes/userRoutes.js` — gold logic
**Impact:** Ensures fair distribution — heavy senders get deprioritized. Plan-weighted scoring rewards premium subscribers.

---

### OPT-9: Staggered Cron Scheduling
**What:** Heavy cron jobs (sitemap, email assign, RFQ) scheduled at different hours to avoid resource spikes.
**Where:** `app.js` and `crons/luncher.js`
**Impact:** Midnight = email renew, 1AM = email assign + free plan extend, 2AM = material sitemap — prevents concurrent heavy DB operations.

---

### OPT-10: Redis-Based Session Auth (vs DB Lookup)
**What:** Auth tokens stored in Redis instead of MongoDB — O(1) lookup on every request.
**Where:** `lib/Authorisation.js`
**Impact:** Every authenticated request does a Redis GET (sub-millisecond) instead of a MongoDB query.

---

### OPT-11: Static File Serving via Express
**What:** Uploaded files served directly by Express from `uploads/` directory.
**Where:** `app.js` line 45
**Impact:** Avoids routing static file requests through the full middleware stack. In production, a CDN (`IMAGE_BASE_URL`) handles this for S3 files.

---

### OPT-12: Spintax for SEO Uniqueness
**What:** Randomized title/meta variations prevent duplicate content penalties across product-grade pages.
**Where:** `modules/admin/allModule/allModuleUtils/utils.js`
**Impact:** Each generated product page has unique SEO metadata despite following the same template.

---

### OPT-13: Scheduled Email Queue (30-second polling)
**What:** Emails can be scheduled for future sending. A cron checks every 30 seconds and sends due emails with retry logic (max 5 retries).
**Where:** `crons/cronJobs.js` — `scheduleEmailCron`
**Impact:** Decouples email creation from sending — prevents API timeout for bulk email operations.

---

### OPT-14: CORS Whitelist (Intended)
**What:** `cors()` middleware with origin whitelist configured per environment.
**Where:** `app.js` lines 59–95
**Impact (intended):** Only allowed domains can make API requests. *Note: undermined by wildcard override at line 180.*

---

## PART 2: Improvements To Make

### IMP-1: Add `.lean()` to All Read-Only Queries — HIGH
**Problem:** Only 5 out of 200+ `.find()` calls use `.lean()`. Every read-only query returns full Mongoose documents with prototype methods, consuming extra memory.
**Where:** `routes/*.js`, `modules/admin/*/services/list.js`, `crons/*.js`
**Fix:** Add `.lean()` to every query where the result is only read (not modified and saved):
```javascript
// Before
const suppliers = await Users.find({ isAdmin: false });

// After — 3-5x faster, 50% less memory
const suppliers = await Users.find({ isAdmin: false }).lean();
```
**Impact:** 3–5x faster queries, 50% less memory per read operation.

---

### IMP-2: Fix N+1 Queries — HIGH
**Problem:** Multiple loops fire individual DB queries per iteration.
**Where found:**

| Location | Pattern | Fix |
|----------|---------|-----|
| `crons/site_map_code.js` | 1 grade query per product | `$lookup` aggregation |
| `crons/cronJobs.js` → `resetEmailLimit` | `Plan.findById` per user after `.populate("planId")` | Remove redundant query |
| `helper/newEmailAssignToSupplier.js` | `Users.updateOne` per supplier in loop | Single `Users.updateMany()` |
| `routes/emailLogic.js:800-809` | `Users.findOne` + `updateOne` per receiver | `Users.updateMany({ email: { $in: receivers } })` |

---

### IMP-3: Fix `uploadToS3.js` — Sharp Not Awaited — HIGH
**Problem:** S3 uploads the original file instead of the WebP conversion (Sharp runs in parallel, not sequentially).
**Where:** `helper/uploadToS3.js`
**Fix:** `await` the Sharp conversion, then read the output file for S3 upload.

---

### IMP-4: Fix CORS Wildcard Override — HIGH
**Problem:** Manual `res.setHeader("Access-Control-Allow-Origin", "*")` at line 180 overrides the cors() whitelist.
**Where:** `app.js` lines 179–192
**Fix:** Remove the manual CORS header middleware entirely — let `cors()` handle it.

---

### IMP-5: Use Async Bcrypt — HIGH
**Problem:** `Bcrypt.hashSync` and `Bcrypt.compareSync` block the event loop for ~300ms per operation (salt rounds = 12).
**Where:** `models/Users.js`, `routes/userRoutes.js`
**Fix:** Use `await Bcrypt.hash()` and `await Bcrypt.compare()`.

---

### IMP-6: Fix `sendAWSRedirectEmail` — Promise Args Swapped — HIGH
**Problem:** Promise constructor arguments are reversed: `new Promise((reject, resolve) => {...})` — resolve is assigned to reject and vice versa.
**Where:** `lib/Notifier.js` — `sendAWSRedirectEmail`
**Fix:** Swap arguments: `new Promise((resolve, reject) => {...})`.

---

### IMP-7: Add `unhandledRejection` Handler — MEDIUM
**Problem:** Unhandled promise rejections are silently swallowed in the main API server.
**Where:** `app.js`
**Fix:**
```javascript
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
  Notifier.notifyTeams(reason, "Unhandled Rejection");
});
```

---

### IMP-8: Sanitize Regex Input — MEDIUM
**Problem:** User search input is passed directly to `new RegExp(search, "i")` — enables ReDoS attacks.
**Where:** `routes/userRoutes.js:1345`, `productCategoryGradesRoutes.js`, `modules/admin/email/services/list.js` (15+ locations)
**Fix:** Escape special regex characters:
```javascript
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const params = { name: { $regex: new RegExp(escapeRegex(search), "i") } };
```

---

### IMP-9: Add Health Check Endpoint — MEDIUM
**Problem:** No way for load balancers or container orchestrators to verify the API is healthy.
**Where:** Not implemented
**Fix:** Add `GET /health` that checks MongoDB and Redis connectivity.

---

### IMP-10: Add Graceful Shutdown — MEDIUM
**Problem:** `SIGINT` calls `process.exit(0)` immediately. `SIGTERM` is unhandled. In-flight requests are dropped.
**Where:** `app.js`
**Fix:** Close server, drain connections, close DB/Redis, then exit.

---

### IMP-11: Enable Helmet — MEDIUM
**Problem:** Security headers (X-Content-Type-Options, X-Frame-Options, HSTS, XSS-Protection) are not set.
**Where:** `app.js` line 108 (commented out)
**Fix:** Uncomment `app.use(helmet())`.

---

### IMP-12: Fix Broken `Promise.all` Pattern — MEDIUM
**Problem:** `await` inside loop before `Promise.all` makes execution sequential, not parallel.
**Where:** `crons/cronJobs.js:157`, `routes/emailLogic.js:801`, `routes/userRoutes.js:2037`
```javascript
// BROKEN — sequential despite Promise.all
let promises = [];
for (let i = 0; i < items.length; ++i) {
  let promise = await Model.updateOne(...); // await runs serially!
  promises.push(promise);
}
await Promise.all(promises); // promises already resolved

// CORRECT — truly parallel
const promises = items.map(item => Model.updateOne(...)); // no await
await Promise.all(promises); // resolves in parallel
```

---

### IMP-13: Remove Duplicate Middleware — LOW
**Problem:** `compression()`, `express.json()`, and `bodyParser.json()` are each registered twice.
**Where:** `app.js` lines 32/159 (compression), 151/154 (json), 153/155 (urlencoded)
**Fix:** Remove the duplicate registrations.

---

### IMP-14: Add Multer File Limits — LOW
**Problem:** No `fileSize` limit or `fileFilter` on any multer instance — unlimited upload size, any file type.
**Where:** `routes/userRoutes.js` lines 6, 50
**Fix:**
```javascript
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'), false);
  }
});
```

---

### IMP-15: Fix Socket.io Security — Emitting Password Hashes — LOW
**Problem:** `supplier_signup` event emits the full user object including bcrypt password hash.
**Where:** `routes/userRoutes.js:290`
**Fix:** Strip sensitive fields before emitting:
```javascript
const { password, ...safeUser } = user.toObject();
myEventHandler("supplier_signup", safeUser);
```

---

### IMP-16: Remove `debugger` Statement — LOW
**Problem:** A `debugger` statement exists in production code — pauses execution if Node inspector is attached.
**Where:** `routes/userRoutes.js:1923`
**Fix:** Delete the line.

---

## PART 3: Priority Matrix

| Priority | Item | Type | Impact |
|----------|------|------|--------|
| **HIGH** | IMP-1: Add `.lean()` to read queries | Performance | 3–5x faster reads |
| **HIGH** | IMP-2: Fix N+1 queries (4 locations) | Performance | 10–100x fewer DB calls |
| **HIGH** | IMP-3: Fix `uploadToS3.js` Sharp bug | Bug | Wrong file format uploaded to S3 |
| **HIGH** | IMP-4: Fix CORS wildcard override | Security | API currently open to all origins |
| **HIGH** | IMP-5: Use async bcrypt | Performance | Unblocks event loop during auth |
| **HIGH** | IMP-6: Fix Promise args in Notifier | Bug | `sendAWSRedirectEmail` always fails |
| **MEDIUM** | IMP-7: Add unhandledRejection handler | Reliability | Prevent silent failures |
| **MEDIUM** | IMP-8: Sanitize regex input | Security | Prevent ReDoS attacks |
| **MEDIUM** | IMP-9: Add health check endpoint | DevOps | Load balancer health monitoring |
| **MEDIUM** | IMP-10: Add graceful shutdown | Reliability | Clean connection drainage |
| **MEDIUM** | IMP-11: Enable helmet | Security | Add standard security headers |
| **MEDIUM** | IMP-12: Fix broken Promise.all | Performance | Enable true parallel execution |
| **LOW** | IMP-13: Remove duplicate middleware | Cleanup | Minor perf improvement |
| **LOW** | IMP-14: Add multer file limits | Security | Prevent oversized uploads |
| **LOW** | IMP-15: Fix Socket.io password leak | Security | Stop emitting password hashes |
| **LOW** | IMP-16: Remove debugger statement | Cleanup | Prevent debugging pause |

---

---

# Section C: Must-Know Interview Questions (Rapid-Fire)

These are common backend/Node.js interview questions that tie directly to this project's code. Each answer references a real implementation.

---

### MK-1: How do you handle file uploads in Node.js?
**Answer:** Multer for multipart/form-data → temporary disk storage → Sharp for image processing → AWS S3 for permanent storage → cleanup temp files.
**Project ref:** `helper/uploadToS3.js`, `routes/userRoutes.js` upload middleware

---

### MK-2: Explain middleware in Express.js.
**Answer:** Functions that execute sequentially on every request. This project uses 16+ middleware in `app.js`: compression, CORS, body parsing, session management, custom logging, timeout, and error handling. Route-level middleware includes auth (`authoriseUser`), admin guard (`onlyAdmin`), and validation (`express-validator` arrays).
**Project ref:** `app.js` lines 32–295

---

### MK-3: What's the difference between `express.json()` and `bodyParser.json()`?
**Answer:** Since Express 4.16+, `express.json()` IS body-parser. They are identical. This project registers both — a redundancy.
**Project ref:** `app.js` lines 151 and 154

---

### MK-4: How do you implement authentication without JWT?
**Answer:** Redis-based session tokens. On login, generate a session ID → store user data in Redis with 30-day TTL → return session ID as token. On each request, read `auth` header → Redis GET → attach user to `req.user`. Session can be destroyed on logout.
**Project ref:** `lib/Authorisation.js` — `authoriseUser`, `saveSessionDetails`, `destroySession`

---

### MK-5: What is the difference between `mongoose.connect()` and `mongoose.createConnection()`?
**Answer:** `mongoose.connect()` creates the default global connection. `mongoose.createConnection()` creates a named, isolated connection. This project uses `createConnection()` so models are registered on a specific connection (`CONN_TO_DB.model()`), not the global mongoose instance. This allows multiple DB connections if needed.
**Project ref:** `lib/dbConnection.js`

---

### MK-6: How do you handle background jobs in Node.js?
**Answer:** Two approaches in this project:
1. **node-cron** — Time-based scheduled jobs (email sending, sitemap generation, plan renewal). Defined in `app.js` and `crons/luncher.js`.
2. **BullMQ** — Event-driven background workers for heavy computation (cartesian product generation). Redis-backed queues with concurrency=1 workers.
**Project ref:** `crons/cronJobs.js`, `modules/admin/allModule/bullmq/`

---

### MK-7: How do you prevent duplicate records in MongoDB?
**Answer:** Multiple strategies used:
1. **Compound unique indexes** — `{ materialId: 1, gradeModelId: 1, unique: true }`
2. **Pre-save validation** — `express-validator` async custom check queries DB before create
3. **Upsert** — `updateOne({ ...match }, { $set: data }, { upsert: true })` — creates or updates
4. **De-duplication in BullMQ logic** — checks existing records before `insertMany`
**Project ref:** `modules/admin/material-grade/validations/`, `modules/admin/allModule/bullmq/allModule.logic.js`

---

### MK-8: What is the `$lookup` operator in MongoDB?
**Answer:** It performs a left outer join between collections. This project uses two forms:
1. **Simple** — `{ $lookup: { from, localField, foreignField, as } }` — single field join
2. **Pipeline** — `{ $lookup: { from, let: { vars }, pipeline: [...], as } }` — multi-field join with `$expr` and additional filtering
**Project ref:** `routes/suppliersRoutes.js`, `routes/userRoutes.js`

---

### MK-9: How do you implement pagination in Express/MongoDB?
**Answer:** Three patterns used:
1. **Skip-Limit** — `Model.find(query).skip((page-1)*limit).limit(limit)` + `countDocuments` for total
2. **Aggregation pagination** — `$skip` + `$limit` stages in aggregation pipeline
3. **In-memory** — `.find().sort()` then `.slice()` (avoid for large datasets)
**Project ref:** `modules/admin/*/services/list.js` (pattern 1), `routes/productCategoryGradesRoutes.js` (pattern 2)

---

### MK-10: How do you handle email sending at scale?
**Answer:** AWS SES with two modes: simple `sendEmail()` for plain text, raw `sendEmail()` with MailComposer for attachments. Scheduling via MongoDB (`ScheduledEmails` model) + 30-second cron polling. Batch sending (20 per batch) for bulk operations. Retry logic (max 5) for failed sends.
**Project ref:** `lib/Notifier.js`, `crons/cronJobs.js`

---

### MK-11: What is CORS and how do you configure it?
**Answer:** Cross-Origin Resource Sharing — browser security that blocks requests from different domains. This project uses the `cors` npm package with a whitelist of allowed origins (localhost, staging, production URLs). Each environment has its own whitelist configured by commenting/uncommenting blocks.
**Project ref:** `app.js` lines 59–95, 140

---

### MK-12: How do you implement real-time features in Node.js?
**Answer:** Socket.io. Server creates a WebSocket server alongside the HTTP server. Events like `supplier_signup` and `unverified_users` are broadcast to all connected clients. The admin dashboard listens for these events to show real-time notifications.
**Project ref:** `config/socket.js`, `routes/userRoutes.js:290`

---

### MK-13: How do you secure an Express API?
**Answer:** Measures in this project:
- Bcrypt password hashing (12 salt rounds)
- Redis session tokens with 30-day TTL
- CORS origin whitelist
- IP/email blocking system (Redis counters + DB records)
- `express-validator` for input validation (admin modules only)
- Multer for controlled file uploads

**Missing but recommended:** helmet.js, CSRF tokens, rate limiting, regex sanitization, `httpOnly` cookies.
**Project ref:** `lib/Authorisation.js`, `lib/Constant.js`, `models/BlockEmailAndIp.js`

---

### MK-14: What is soft delete and why use it?
**Answer:** Instead of `DELETE FROM collection`, add a `deletedAt` timestamp. All queries filter `{ deletedAt: null }`. Benefits: data recovery, audit trail, referential integrity. This project uses it across all admin modules.
**Project ref:** `modules/admin/*/services/list.js` — `{ deletedAt: null }` filter

---

### MK-15: How do you handle environment configuration?
**Answer:** This project uses two approaches:
1. **`.env` file** (via dotenv) for `NODE_ENV`, `RUN_CRON`, `INFO_LOG_PATH`, `IMAGE_BASE_URL`, etc.
2. **Comment-based switching** in `config/config.js` — database URLs and API URLs are hardcoded and toggled by commenting/uncommenting blocks for local/staging/production.

The comment-based approach is error-prone. Best practice: use `.env` for ALL environment-specific values.
**Project ref:** `config/config.js`, `app.js` lines 59–95

---

### MK-16: What is the event loop? How does `Bcrypt.hashSync` affect it?
**Answer:** The event loop is Node.js's mechanism for handling I/O asynchronously despite being single-threaded. It processes callbacks from the callback queue when the call stack is empty.

`Bcrypt.hashSync(password, 12)` performs CPU-intensive hashing on the main thread — blocks the event loop for ~300ms. During that time, Node cannot process any other requests. The async version `Bcrypt.hash()` offloads to a worker thread via libuv's thread pool.
**Project ref:** `models/Users.js` — `hashPassword` and `comparePassword` statics

---

### MK-17: What is the difference between `populate()` and `$lookup`?
**Answer:**
- **`populate()`** — Mongoose convenience method. Runs a separate query per populated field. Happens at the application level.
- **`$lookup`** — MongoDB aggregation stage. Runs the join at the database level in a single query.

This project's `resetEmailLimit` cron uses `.populate("planId")` to load plans, then **redundantly** calls `Plan.findById(user.planId)` inside the loop — an N+1 caused by not trusting `populate()`.
**Project ref:** `crons/cronJobs.js` lines 249–263

---

### MK-18: How do you implement a producer-consumer pattern in Node.js?
**Answer:** BullMQ (Redis-backed). Producer (controller) enqueues a job via `queue.add("JOB_NAME", data)` and returns immediately. Consumer (worker) processes the job asynchronously with `new Worker("JOB_NAME", handler, { concurrency: 1 })`. Events: `completed`, `failed`.
**Project ref:** `modules/admin/allModule/bullmq/Controller.js` (producer), `worker.js` (consumer)

---

### MK-19: How do you design a response format for an API?
**Answer:** This project uses two coexisting formats:

**Format 1** (main routes — `lib/utilFunctions.js`):
```json
{ "message": "success", "data": {...}, "total": 100, "status": 1 }
{ "message": "error message", "status": 0 }
```

**Format 2** (admin modules — `helper/response.js`):
```json
{ "statusCode": 200, "responseMessage": "Grade detail", "data": {...} }
```

**Issue:** Two different response formats coexist. Clients must handle both.

---

### MK-20: What are the pros and cons of Redis vs MongoDB for sessions?
**Answer:**
| | Redis | MongoDB |
|--|-------|---------|
| **Speed** | Sub-millisecond (in-memory) | 1–10ms (disk-based) |
| **TTL** | Native `EX` flag | TTL indexes (delayed cleanup) |
| **Persistence** | Optional (RDB/AOF) | Always persisted |
| **Scalability** | Single-node limitation | Replica sets/sharding |

This project chose Redis for sessions because auth middleware runs on **every request** — the sub-millisecond lookup is critical for API performance.
**Project ref:** `lib/Authorisation.js` — `redisClient.get(token)`

---

### MK-21: How do you implement search across multiple collections?
**Answer:** Cascading search pattern — query collections in priority order, stop when enough results are found:
1. Products first (highest priority)
2. Materials (if < 10 results)
3. ProductMaterial (if < 10 results)
4. Grades (if < 10 results)

Cache results in Redis (5-min TTL) to avoid repeated DB queries for the same search term.
**Project ref:** `routes/userRoutes.js` — `fetchUsersBySearch`

---

### MK-22: How do you generate SEO-friendly URLs?
**Answer:** 6-tier cascading fallback for supplier URLs: company name → name+country → name+city → name+city+country → contact person name → contact+incremental number. Each tier checks DB for uniqueness before moving to the next.

For product pages, spintax generates randomized title/meta: `{Buy|Purchase|Get} {Premium|Quality} Product` — each expansion is unique for search engines.
**Project ref:** `lib/utilFunctions.js`, `modules/admin/allModule/allModuleUtils/utils.js`

---

### MK-23: What logging best practices should a Node.js API follow?
**Answer:** This project demonstrates:
- **Winston** for structured application logs (5 levels: error→warn→info→http→debug)
- **Morgan** for HTTP request logs (method, path, status, response time)
- **Rotating file transport** (5MB max, 5 files = 25MB total)
- **Environment-based filtering** (debug in dev, info in prod)

**Missing best practices:** correlation IDs per request, separate error log file, log aggregation service (ELK/Datadog), PII masking (currently logs full request bodies in dev).
**Project ref:** `config/LoggerConfig.js`, `app.js`

---

### MK-24: What is the difference between `PUT` and `PATCH`?
**Answer:** `PUT` replaces the entire resource; `PATCH` updates specific fields. This project uses:
- `PUT` for full updates (e.g., `PUT /api/v1/admin/plan/update/:id`)
- No `PATCH` endpoints — all updates send the full object

Most routes actually do partial updates via `findByIdAndUpdate` with `$set`, which is semantically `PATCH` behavior despite using `PUT` HTTP methods.
**Project ref:** `modules/admin/*/routes/*.js`

---

### MK-25: How do you handle database connection errors in Node.js?
**Answer:** Mongoose connection events in `lib/dbConnection.js`:
```javascript
CONN_TO_DB.on('error', (err) => logger.error('MongoDB connection error:', err));
CONN_TO_DB.on('connected', () => logger.info('Connected to MongoDB'));
CONN_TO_DB.on('disconnected', () => logger.warn('MongoDB disconnected'));
```

**Important:** This project does NOT implement automatic reconnection logic or circuit breaker patterns. If MongoDB goes down, all DB queries fail until manual restart.

---

## Bonus: Quick Reference — Key File Locations

| What | File Path |
|------|-----------|
| Express setup & middleware | `app.js` |
| HTTP server entry | `webServers/pipingMart.js` |
| Auth middleware | `lib/Authorisation.js` |
| DB connection | `lib/dbConnection.js` |
| All constants | `lib/Constant.js` |
| Email sender | `lib/Notifier.js` |
| Utility functions | `lib/utilFunctions.js` |
| S3 upload | `helper/uploadToS3.js` |
| Response helpers | `helper/response.js` |
| User/Auth routes | `routes/userRoutes.js` |
| Product catalog | `routes/productCategoryGradesRoutes.js` |
| Supplier routes | `routes/suppliersRoutes.js` |
| Email logic | `routes/emailLogic.js` |
| Cron definitions | `crons/luncher.js` + `app.js` |
| Cron implementations | `crons/cronJobs.js` |
| BullMQ workers | `modules/admin/allModule/bullmq/worker.js` |
| BullMQ logic | `modules/admin/allModule/bullmq/allModule.logic.js` |
| Admin module template | `modules/admin/grade/` (simplest example) |
| RFQ distribution | `crons/cronJobs.js` → `sendRfqToFreeSuppliers()` |
| Supplier ranking | `routes/userRoutes.js` → `fetchUsersByPlan()` |
