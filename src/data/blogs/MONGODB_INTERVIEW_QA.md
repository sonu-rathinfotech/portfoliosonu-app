# MongoDB Interview Questions & Answers — ThePipingMart Project

All questions, answers, and code examples are based on actual patterns used in the `pipeingMartBackend_staginDev` codebase.

---

## Table of Contents

1. [Mongoose Connection Pattern](#1-mongoose-connection-pattern)
2. [Schema Design & Field Types](#2-schema-design--field-types)
3. [Indexing Strategy](#3-indexing-strategy)
4. [CRUD — Create Operations](#4-crud--create-operations)
5. [CRUD — Read Operations (find / findOne)](#5-crud--read-operations)
6. [CRUD — Update Operations](#6-crud--update-operations)
7. [CRUD — Delete Operations](#7-crud--delete-operations)
8. [Aggregation Pipelines](#8-aggregation-pipelines)
9. [$lookup — Joins in MongoDB](#9-lookup--joins-in-mongodb)
10. [$group and $unwind](#10-group-and-unwind)
11. [$dateDiff and Date Queries](#11-datediff-and-date-queries)
12. [$sample — Random Sampling](#12-sample--random-sampling)
13. [Query Operators ($in, $or, $ne, $regex, etc.)](#13-query-operators)
14. [Update Operators ($set, $inc, $push, $setOnInsert)](#14-update-operators)
15. [Pagination & Sorting](#15-pagination--sorting)
16. [Populate vs $lookup](#16-populate-vs-lookup)
17. [Soft Delete Pattern](#17-soft-delete-pattern)
18. [Upsert Pattern](#18-upsert-pattern)
19. [Bulk Operations (bulkWrite / insertMany / updateMany)](#19-bulk-operations)
20. [Text Search & Atlas Search](#20-text-search--atlas-search)
21. [Password Hashing with Static Methods](#21-password-hashing-with-static-methods)
22. [countDocuments & Counting](#22-countdocuments--counting)
23. [Projection / .select()](#23-projection--select)
24. [Enum Validation in Schema](#24-enum-validation-in-schema)
25. [Timestamps Option](#25-timestamps-option)
26. [Batch Processing in Cron Jobs](#26-batch-processing-in-cron-jobs)
27. [BullMQ + MongoDB — Background Workers](#27-bullmq--mongodb--background-workers)
28. [Full-Text Index](#28-full-text-index)
29. [$expr — Expression Operator](#29-expr--expression-operator)
30. [$facet — Multiple Pipelines in One Query](#30-facet--multiple-pipelines-in-one-query)
31. [Duplicate Key Error Handling (Error Code 11000)](#31-duplicate-key-error-handling-error-code-11000)
32. [ObjectId vs String IDs — Design Trade-offs](#32-objectid-vs-string-ids--design-trade-offs)
33. [$replaceRoot and $mergeObjects](#33-replaceroot-and-mergeobjects)
34. [Multiple Schemas in One File](#34-multiple-schemas-in-one-file)
35. [Collection Name Override (Third Argument)](#35-collection-name-override-third-argument)
36. [Data Denormalization Pattern](#36-data-denormalization-pattern)
37. [Nested/Dot Notation Queries](#37-nesteddot-notation-queries)
38. [$push with $each — Bulk Array Operations](#38-push-with-each--bulk-array-operations)
39. [Mongoose .lean() for Performance](#39-mongoose-lean-for-performance)
40. [Mongoose Connection Events](#40-mongoose-connection-events)
41. [Conditional Schema Validation](#41-conditional-schema-validation)
42. [Instance Methods vs Static Methods](#42-instance-methods-vs-static-methods)
43. [Schema Default Value Pitfalls](#43-schema-default-value-pitfalls)
44. [Redis + MongoDB Caching Pattern](#44-redis--mongodb-caching-pattern)
45. [preserveNullAndEmptyArrays in $unwind](#45-preservenullandemptyarrays-in-unwind)
46. [$$NOW — System Variable for Current Time](#46-now--system-variable-for-current-time)
47. [$meta — Text Score and Search Metadata](#47-meta--text-score-and-search-metadata)
48. [Callback vs Promise vs Async/Await Patterns](#48-callback-vs-promise-vs-asyncawait-patterns)
49. [Mongoose useFindAndModify Option](#49-mongoose-usefindandmodify-option)
50. [Schema ref — How populate() Knows Where to Look](#50-schema-ref--how-populate-knows-where-to-look)
51. [Handling Optional/Dynamic Query Conditions](#51-handling-optionaldynamic-query-conditions)
52. [$$ROOT vs $$CURRENT — Aggregation Document References](#52-root-vs-current--aggregation-document-references)
53. [Mongoose Schema Types — Complete Reference](#53-mongoose-schema-types--complete-reference)
54. [MongoDB Connection Pooling](#54-mongodb-connection-pooling)
55. [MongoDB Transactions — Why This Project Doesn't Use Them](#55-mongodb-transactions--why-this-project-doesnt-use-them)
56. [explain() — Debugging Slow Queries](#56-explain--debugging-slow-queries)
57. [Mongoose Middleware (Pre/Post Hooks)](#57-mongoose-middleware-prepost-hooks)
58. [Aggregation Pipeline Optimization Tips](#58-aggregation-pipeline-optimization-tips)
59. [MongoDB Data Types — ObjectId Internals](#59-mongodb-data-types--objectid-internals)
60. [Common MongoDB Anti-Patterns Found in This Project](#60-common-mongodb-anti-patterns-found-in-this-project)

### Section B: Optimizations & Improvements
- [PART 1: Optimizations Already Done (OPT-1 to OPT-14)](#part-1-optimizations-already-done-in-this-project)
- [PART 2: What We Can Improve (IMP-1 to IMP-13)](#part-2-what-we-can-improve-with-code-examples)
- [PART 3: Priority Matrix](#part-3-quick-reference--priority-matrix)

---

## 1. Mongoose Connection Pattern

**Q: What is the difference between `mongoose.connect()` and `mongoose.createConnection()`? Which one does this project use and why?**

**A:** `mongoose.connect()` creates a default connection shared across all models. `mongoose.createConnection()` creates a separate, named connection — useful when connecting to multiple databases or when you need explicit control.

This project uses `mongoose.createConnection()` because it allows exporting the connection object and passing it explicitly to models, giving better control over which database each model talks to.

**Where it's used:**

`models/dbConnection.js` (or `lib/dbConnection.js`):
```javascript
const mongoose = require("mongoose");
const { MONGODB_ADDRESS } = require("../config/config");

const CONN_TO_DB = mongoose.createConnection(MONGODB_ADDRESS, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

module.exports = { CONN_TO_DB };
```

Every model registers via:
```javascript
const Products = CONN_TO_DB.model('products', productSchema);
```
> File: `models/Products.js` (line ~218)

---

**Q: Why do models use `CONN_TO_DB.model()` instead of `mongoose.model()`?**

**A:** When you use `mongoose.createConnection()`, the models must be registered on that specific connection instance, not on the default mongoose object. If you used `mongoose.model()`, the model would be registered on a different (default) connection and wouldn't find your data.

---

## 2. Schema Design & Field Types

**Q: Explain the schema design for the Users model. What field types and validators are used?**

**A:** The Users model is the most complex schema in the project. It uses mixed field types, nested objects, indexed fields, and default values.

**Where it's used:** `models/Users.js`

```javascript
const userSchema = new Schema({
  userId:          { type: String, index: true, unique: true, required: true },
  url:             { type: String, index: true, required: true },
  email:           { type: String, index: true },
  password:        { type: String },
  name:            { type: String, default: '', index: true },
  mobileNo:        { type: String, index: true },
  isAdmin:         { type: Boolean, default: false },
  isSeller:        { type: Boolean, default: false },
  isNormalUser:    { type: Boolean, default: true },
  active:          { type: Boolean, default: true },
  assignedEmailId: { type: String, default: 'enquiry@pipingmart.in', index: true, required: true },

  // Plan fields
  planId:              { type: Schema.Types.ObjectId, ref: 'plan' },
  planName:            String,
  totalEmailLimit:     Number,
  remainingEmailLimit: Number,
  totalProductLimit:   Number,
  remainingProductLimit: Number,
  planActivationDate:  Date,
  planExpiryDate:      Date,

  // Nested object
  emailPlan: {
    planType:         { type: Schema.Types.ObjectId },
    userEmailLimit:   Number,
    currentEmailSent: Number,
    renewDate:        Date
  },

  // Admin permissions (17 boolean flags)
  permissions: {
    canManageUser:    { type: Boolean, default: false },
    canManageProduct: { type: Boolean, default: false },
    // ... 15 more
  },

  deletedAt:  { type: Date, default: null },
  createdAt:  { type: Date },
  updatedAt:  { type: Date }
});
```

**Key design decisions:**
- `userId` is a string (not ObjectId) — custom ID generation
- `planId` references the Plan collection via `ObjectId`
- `emailPlan` is an embedded sub-document (not a separate collection) for performance
- `permissions` is embedded rather than a separate role model — simplicity over normalization

---

**Q: How is the Product-Material-Grade hierarchy modeled?**

**A:** The project uses a relational-style linking approach with separate collections:

| Collection | Primary Key | References |
|-----------|------------|------------|
| `products` | `productId` (String) | — |
| `materials` | `materialId` (String) | — |
| `gradeModel` (grade.js) | `_id` (ObjectId) | — |
| `productmaterialgrades` (Grades.js) | `gradeId` (String) | `productId`, `materialId`, `gradeModelId`, `equivalentModelId` |
| `suppliers` | `_id` (ObjectId) | `userId`, `productId`, `materialId`, `gradeId` |

**Where it's used:**
- `models/Products.js` — Product & SubProduct schemas
- `models/Materials.js` — Material & ProductMaterialMap schemas
- `models/Grades.js` — ProductMaterialGrade (links product + material + grade)
- `models/grade.js` — Standalone grade master
- `models/Suppliers.js` — Supplier product listings (junction table)

---

## 3. Indexing Strategy

**Q: What indexing strategy is used in this project? Give examples of single-field, compound, and unique indexes.**

**A:**

### Single-field indexed + unique
```javascript
// models/Products.js
productId: { type: String, required: true, index: true, unique: true }
url:       { type: String, index: true, required: true, unique: true }
code:      { type: String, default: null, index: true, unique: true }
```

### Single-field indexed (non-unique)
```javascript
// models/Suppliers.js
userId:     { type: String, index: true }
productId:  { type: String, index: true, default: null }
materialId: { type: String, index: true, default: null }
gradeId:    { type: String, index: true, default: null }
addedOn:    { type: Date, default: Date.now(), index: true }
```

### Compound unique index
```javascript
// models/Suppliers.js — HotProductSuppliers
HotProductSuppliersSchema.index({ userId: 1, productId: 1, materialId: 1 }, { unique: true });
```

### Full-text index (wildcard)
```javascript
// models/AllEmails.js
AllEmailsSchema.index({ '$**': 'text' });
```

**Why this matters:** Every foreign key (`userId`, `productId`, `materialId`, `gradeId`) is indexed because they appear in `$match` and `$lookup` stages in aggregation pipelines. Without these indexes, join operations would do full collection scans.

---

## 4. CRUD — Create Operations

**Q: How are new documents created in this project? Show the different patterns used.**

**A:** Three patterns are used:

### Pattern 1: `new Model().save()` with callback
```javascript
// routes/userRoutes.js — User registration (line ~242)
let user = new Users(userDetails);
user.save((e, response) => {
  if (e) return handleDBError(res, e);
  return handleSuccessResponse(res, response);
});
```

### Pattern 2: `Model.create()` with async/await
```javascript
// modules/admin/Rfqs/controller/Add.js
const rfq = await RfqModel.create({ ...req.body });
```

### Pattern 3: `Model.insertMany()` for bulk creation
```javascript
// modules/admin/allModule/bullmq/allModule.logic.js
const inserted = await Grades.insertMany(newDataArray);
await AllModule.insertMany(inserted.map(e => ({
  productMaterialGradeId: e._id
})));
```

**Where each is used:**
- `new + save()` — User signup (`routes/userRoutes.js`), News creation, Review creation
- `Model.create()` — RFQ creation, Block email/IP, Email plan creation
- `insertMany()` — BullMQ background workers for bulk grade/product mappings

---

## 5. CRUD — Read Operations

**Q: Explain the different find patterns used in this project with real examples.**

**A:**

### findOne with $or (login by email or mobile)
```javascript
// routes/userRoutes.js — line ~362
Users.findOne({
  $or: [
    { email: userCred, active: true },
    { mobileNo: userCred, active: true }
  ]
});
```

### findOne with projection (selective fields)
```javascript
// routes/userRoutes.js — line ~563
Users.findOne(
  { userId: req.body.userId },
  { userId: 1, email: 1, _id: 0 }  // Only return userId & email, exclude _id
);
```

### find with $ne (not equal)
```javascript
// routes/userRoutes.js — line ~284
News.find(
  { id: { $ne: "NaN" } },
  { _id: 1, id: 1 }
).sort({ date: -1 }).limit(1);
```

### findById with soft-delete check
```javascript
// routes/userRoutes.js — line ~546
Users.findById({ _id: req.params.id, deletedAt: null });
```

### find with populate (join plan details)
```javascript
// routes/suppliersRoutes.js — line ~728
Users.find(searchQueryforUser, { name: 1, email: 1, mobileNo: 1 })
  .populate({ path: "planId" })
  .sort("-createdAt");
```

---

**Q: How do you search for a user who can be identified by email, mobile number, URL, or userId?**

**A:** Use `$or` with all possible identifier fields:

```javascript
// routes/userRoutes.js — line ~594
Users.findOne({
  $or: [
    { url: userId },
    { userId: userId },
    { email: userId },
    { mobileNo: userId }
  ]
});
```
This is used when an admin looks up a user and might provide any identifier.

---

## 6. CRUD — Update Operations

**Q: What are the different update methods used? When do you use each?**

**A:**

### findOneAndUpdate (returns the updated document)
```javascript
// routes/userRoutes.js — line ~518
Users.findOneAndUpdate(
  { userId: userId_of_selected_user },
  { $set: { name: "New Name", ...updateFields } },
  { new: true }   // Return the updated doc, not the old one
);
```

### findByIdAndUpdate
```javascript
// routes/userRoutes.js — line ~534
Users.findByIdAndUpdate(
  req.body.userId,
  { $set: { permissions: req.body.permissions } },
  { new: true, useFindAndModify: false }
);
```

### updateOne (no document returned)
```javascript
// modules/admin/user/services/update-status.js
Users.updateOne(
  { _id: id },
  { $set: { active: isActive } }
);
```

### updateMany (batch update)
```javascript
// routes/userRoutes.js — line ~1598
Users.updateMany(
  { isAdmin: false, "plan.name": planType },
  { "emailPlan.userEmailLimit": emailLimit }
);
```

**When to use which:**
- `findOneAndUpdate` — when you need the updated document back (e.g., returning response to client)
- `updateOne` — when you just need confirmation of update, don't need the doc
- `updateMany` — when updating multiple docs at once (e.g., changing plan limits for all suppliers of a plan type)

---

## 7. CRUD — Delete Operations

**Q: How does this project handle deletions?**

**A:** The project uses both **hard deletes** and **soft deletes**:

### Hard delete — deleteMany
```javascript
// routes/userRoutes.js — line ~287
UnregisteredModel.deleteMany({ email: user.email });
```

### Hard delete — findOneAndDelete
```javascript
// routes/userRoutes.js — line ~2157
NewUser.findOneAndDelete({ email }, user_details);
```

### Hard delete — remove (deprecated)
```javascript
// routes/userRoutes.js — line ~1485
News.remove({ id: id });
```

### Soft delete — set deletedAt timestamp
```javascript
// Not an explicit update call — soft delete is handled by:
// 1. Setting deletedAt: Date.now() on the record
// 2. Filtering with deletedAt: null in all queries
```

See [Soft Delete Pattern](#17-soft-delete-pattern) section for details.

---

## 8. Aggregation Pipelines

**Q: Explain the aggregation framework. What stages have been used in this project?**

**A:** The aggregation framework processes documents through a pipeline of stages. This project uses these stages:

| Stage | Purpose | Where Used |
|-------|---------|------------|
| `$match` | Filter documents | Every pipeline |
| `$group` | Group + accumulate | Supplier counts, email stats |
| `$lookup` | Join collections | Hot product suppliers, dashboard |
| `$unwind` | Flatten arrays | After $lookup, email receivers |
| `$project` | Shape output fields | News search, dashboard |
| `$addFields` | Add computed fields | Plan expiry calculation |
| `$sort` | Order results | Email sent count, dates |
| `$skip` / `$limit` | Pagination | RFQ listing, batch processing |
| `$count` | Count documents | RFQ totals, supplier counts |
| `$sample` | Random selection | Random RFQ display |
| `$search` | Atlas full-text search | News search |
| `$dateDiff` | Date arithmetic | Plan expiry days |
| `$replaceRoot` | Replace document root | Material grade mapping |
| `$mergeObjects` | Merge documents | Material name injection |

---

**Q: Show me a complex aggregation pipeline from this project and explain each stage.**

**A:** Here's the **Hot Product Suppliers** pipeline — one of the most complex in the project:

```javascript
// routes/userRoutes.js — lines 1802-1864
HotProductSuppliers.aggregate([
  // Stage 1: Filter by product + material combination
  {
    $match: {
      productId: productId?.toString(),
      materialId: materialId?.toString()
    }
  },

  // Stage 2: Join with users collection using nested pipeline
  {
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "userId",
      as: "userId",
      pipeline: [
        // Sub-stage 2a: Only users with matching plan and remaining email quota
        {
          $match: {
            planId: { $in: req.body.planId?.map((e) => new mongoose.Types.ObjectId(e)) },
            remainingEmailLimit: { $gt: 0 }
          }
        },
        // Sub-stage 2b: Calculate days until plan expiry
        {
          $addFields: {
            plainExpiresInDays: {
              $dateDiff: {
                startDate: "$$NOW",
                endDate: "$planExpiryDate",
                unit: "day"
              }
            }
          }
        },
        // Sub-stage 2c: Only keep users with 0-75 days until expiry
        {
          $match: {
            plainExpiresInDays: { $gt: 0, $lte: 75 }
          }
        },
        // Sub-stage 2d: Join with plan collection for plan details
        {
          $lookup: {
            from: "plan",
            localField: "planId",
            foreignField: "_id",
            as: "planId"
          }
        },
        // Sub-stage 2e: Flatten plan array to single object
        {
          $unwind: {
            path: "$planId",
            preserveNullAndEmptyArrays: false
          }
        },
        // Sub-stage 2f: Sort by emails sent (most active first)
        {
          $sort: { 'email.currentEmailSent': -1 }
        }
      ]
    }
  },

  // Stage 3: Flatten user array (removes entries with no matching user)
  {
    $unwind: {
      path: "$userId",
      preserveNullAndEmptyArrays: false
    }
  }
]);
```

**Business context:** This finds the best suppliers for a hot product by:
1. Finding suppliers who list the specific product+material
2. Filtering to only those with active paid plans and email quota remaining
3. Calculating plan expiry to exclude expired plans
4. Joining plan details for ranking
5. Sorting by email activity (most engaged suppliers first)

---

## 9. $lookup — Joins in MongoDB

**Q: What is $lookup? Show the two different syntaxes used in this project.**

**A:** `$lookup` performs a left outer join with another collection. There are two forms:

### Simple $lookup (equality join)
```javascript
// modules/admin/dashboard/services/list-top-10-supplier.js
{
  $lookup: {
    from: "users",
    localField: "_id",       // Field from current collection
    foreignField: "email",   // Field from "users" collection
    as: "userDetails"        // Output array field name
  }
}
```

### Pipeline $lookup (complex join with filtering)
```javascript
// routes/suppliersRoutes.js — lines 998-1088
{
  $lookup: {
    from: "suppliers",
    let: { gradeIds: "$gradeId" },    // Variables from current pipeline
    pipeline: [
      {
        $match: {
          $expr: { $in: ["$gradeId", "$$gradeIds"] },  // Use $expr for variable comparison
          userId: { $in: objectIds }
        }
      },
      {
        $project: { userId: 1, gradeId: 1 }
      }
    ],
    as: "suppliers"
  }
}
```

**Key difference:** Pipeline `$lookup` allows:
- Custom filtering inside the join (not just equality)
- Using variables from the parent document (`let` + `$$variable`)
- Projection/sorting inside the sub-pipeline
- Multiple `$match` conditions

**Where each is used:**
- Simple: Dashboard top-10 suppliers, plan details lookup
- Pipeline: Hot product suppliers, grade-to-supplier matching

---

## 10. $group and $unwind

**Q: What is $group and when do you use $unwind before or after it?**

**A:**

### $group — Aggregate documents by a key
```javascript
// routes/suppliersRoutes.js — line 646
Suppliers.aggregate([
  { $match: { deletedAt: null } },
  { $group: { _id: "$userId", count: { $sum: 1 } } }
]);
```
**Context:** Count how many products each supplier has listed.

### $unwind before $group — Flatten arrays, then aggregate
```javascript
// routes/suppliersRoutes.js — lines 686-695
Emails.aggregate([
  { $unwind: "$receiverEmail" },    // receiverEmail is an array → 1 doc per email
  {
    $match: {
      status: { $in: ["sent", "approve"] },
      sentDate: { $gt: new Date("2023-05-15") }
    }
  },
  {
    $group: {
      _id: "$receiverEmail",
      count: { $sum: 1 }
    }
  }
]);
```
**Context:** Count emails received by each supplier (receiverEmail is an array field).

### Dashboard: Top 10 Suppliers
```javascript
// modules/admin/dashboard/services/list-top-10-supplier.js
AllEmails.aggregate([
  { $match: supplierQuery },
  { $unwind: "$receiverEmail" },
  { $group: { _id: "$receiverEmail", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  {
    $lookup: {
      from: "users",
      localField: "_id",
      foreignField: "email",
      as: "userDetails"
    }
  },
  {
    $unwind: {
      path: "$userDetails",
      preserveNullAndEmptyArrays: false
    }
  },
  {
    $project: {
      _id: 0,
      supplierEmail: "$_id",
      supplierName: "$userDetails.name",
      count: 1
    }
  }
]);
```

### $unwind after $lookup — Flatten joined array
```javascript
{
  $unwind: {
    path: "$planId",
    preserveNullAndEmptyArrays: false  // Acts like INNER JOIN (excludes non-matches)
  }
}
```

**Key point:** `preserveNullAndEmptyArrays: false` = INNER JOIN behavior. `true` = LEFT JOIN.

---

## 11. $dateDiff and Date Queries

**Q: How does this project perform date arithmetic in MongoDB?**

**A:**

### $dateDiff (MongoDB 5.0+) — Calculate days between dates
```javascript
// routes/userRoutes.js — lines 1823-1831
{
  $addFields: {
    plainExpiresInDays: {
      $dateDiff: {
        startDate: "$$NOW",        // Current server time
        endDate: "$planExpiryDate", // Field from document
        unit: "day"
      }
    }
  }
}
```
**Context:** Calculate how many days until a supplier's plan expires, then filter to only show suppliers with 0-75 days remaining.

### Date range queries
```javascript
// modules/admin/Rfqs/controller/List.js — line 53
RfqModel.aggregate([
  {
    $match: {
      createdAt: { $gte: daysAgo, $lte: tillDate }
    }
  },
  { $count: "TotalRfqs" }
]);
```
**Context:** Count RFQs within a date range for dashboard stats.

### Find scheduled items due for processing
```javascript
// crons/cronJobs.js — line 30
ScheduledEmails.find({
  active: true,
  nextExecutionTime: { $lte: IST_date },  // Due now or overdue
  retry: { $lte: 5 },                      // Max 5 retry attempts
  executedAt: null                          // Not yet executed
});
```
**Context:** Cron job finds pending scheduled emails that are due for sending.

### Date-based filtering for stale records
```javascript
// helper/newEmailAssignToSupplier.js — line 9
Users.find({
  isAdmin: false,
  updatedAt: { $lte: date },   // Not updated in last month
  deletedAt: null
});
```
**Context:** Find inactive suppliers (not updated in 30 days) to reassign their email.

---

## 12. $sample — Random Sampling

**Q: How do you randomly select documents from MongoDB?**

**A:** Use the `$sample` aggregation stage:

```javascript
// modules/admin/Rfqs/controller/List.js — lines 134-146
RfqModel.aggregate([
  {
    $match: {
      status: true,
      createdAt: { $gte: daysAgo, $lte: tillDate }
    }
  },
  {
    $sample: { size: 5 }   // Randomly pick 5 documents
  }
]);
```

**Context:** Display 5 random recent RFQs on the website to show variety to visitors. Using `$sample` instead of `$sort: { random: 1 }` is MongoDB's built-in efficient random selection.

**Important:** `$sample` after `$match` first filters, then randomly picks from the filtered set.

---

## 13. Query Operators

**Q: List all MongoDB query operators used in this project with examples.**

**A:**

### $or — Match any condition
```javascript
// routes/userRoutes.js — line ~98 (registration duplicate check)
Users.findOne({
  $or: [{ email: req.body.email }, { mobileNo: req.body.mobileNo }]
});
```

### $in — Match any value in array
```javascript
// routes/suppliersRoutes.js — line ~681
{ userId: { $in: objectIds } }

// routes/userRoutes.js — line ~1818 (map string IDs to ObjectIds)
{ planId: { $in: req.body.planId?.map((e) => new mongoose.Types.ObjectId(e)) } }
```

### $ne — Not equal
```javascript
// routes/userRoutes.js — line ~284
News.find({ id: { $ne: "NaN" } });

// modules/admin/blockEmail/controller/blockEmail.js (exclude self during update)
blockEmailModel.findOne({ email: data?.email, _id: { $ne: id } });
```

### $regex — Pattern matching (case-insensitive search)
```javascript
// modules/admin/email/services/list.js — lines 51-59
{
  $or: [
    { companyName: { $regex: new RegExp(search, "i") } },
    { receiverEmail: { $regex: new RegExp(search, "i") } },
    { "senderDetails.email": { $regex: new RegExp(search, "i") } },
    { "senderDetails.name": { $regex: new RegExp(search, "i") } },
    { "emailContent.subject": { $regex: new RegExp(search, "i") } }
  ]
}
```

### $gt, $gte, $lt, $lte — Comparison
```javascript
// routes/suppliersRoutes.js — line ~688
{ sentDate: { $gt: new Date("2023-05-15") } }

// crons/cronJobs.js — line ~30
{ retry: { $lte: 5 }, nextExecutionTime: { $lte: IST_date } }

// routes/userRoutes.js — plan expiry filter
{ plainExpiresInDays: { $gt: 0, $lte: 75 } }
```

### $not — Negation with regex
```javascript
// routes/productCategoryGradesRoutes.js — line ~2733
{ planName: { $not: { $regex: "gold", $options: "i" } } }
```

### $exists — Check field existence
Used implicitly in queries where fields may not exist on all documents.

---

## 14. Update Operators

**Q: What update operators are used and what does each do?**

**A:**

### $set — Set field values
```javascript
// routes/userRoutes.js — line ~1382
News.findOneAndUpdate(
  { id: req.body.id },
  { $set: { title: "...", body: "...", url: "..." } },
  { new: true }
);
```

### $inc — Increment/decrement a number
```javascript
// crons/cronJobs.js — lines 76-83
ScheduledEmails.updateMany(
  { _id: { $in: succeeded } },
  {
    $set: { active: false, executedAt: IST_date },
    $inc: { retry: 1 }   // Increment retry count by 1
  }
);
```

### $push — Add to array
```javascript
// routes/userRoutes.js — line ~518 (user profile update)
Users.findOneAndUpdate(
  { userId: userId },
  { $push: { "products": newProduct } },
  { new: true }
);
```

### $setOnInsert — Only set on insert (used with upsert)
```javascript
// routes/emailLogic.js — lines 64-82
UserEmailStats.findOneAndUpdate(
  { userId: req.body.userId.toString().trim() },
  {
    $set: { emailSendCount: count },
    $setOnInsert: { userId: req.body.userId.toString().trim() }  // Only set userId on first create
  },
  { new: true, upsert: true }
);
```

**Why $setOnInsert matters:** When upserting, `$set` runs on both insert and update. `$setOnInsert` only runs when a new document is created — prevents overwriting the identifier field on subsequent updates.

---

## 15. Pagination & Sorting

**Q: How is pagination implemented in this project?**

**A:** Two approaches are used:

### Approach 1: Mongoose `.skip().limit().sort()`
```javascript
// routes/userRoutes.js — lines 1327-1329
News.find(search_query)
  .sort({ date: -1 })           // Newest first
  .skip((page - 1) * 10)        // Skip previous pages
  .limit(10);                    // 10 per page
```

### Approach 2: Aggregation pipeline stages
```javascript
// modules/admin/Rfqs/controller/List.js — lines 82-98
RfqModel.aggregate([
  { $match: { status: true } },
  { $sort: { createdAt: -1 } },
  { $limit: 100 },                    // Hard cap at 100
  { $skip: (page - 1) * limit },      // Then paginate
  { $limit: limit }
]);
```

### Approach 3: find() with options object
```javascript
// modules/admin/grade/services/list.js
GradeModel.find(gradeQuery, null, {
  limit: +perPage,
  skip: +perPage * (+page - 1),
  sort: { createdAt: -1 }
});
```

### Combined with countDocuments for total pages
```javascript
// modules/admin/email/services/list.js — lines 63-68
const [emails, total] = await Promise.all([
  Emails.find(emailQuery)
    .limit(+perPage)
    .skip(+perPage * (+page - 1))
    .sort(sortBy),
  Emails.countDocuments(emailQuery)
]);
```

**Sort direction:** `-1` = descending (newest first), `1` = ascending. String shorthand: `"-createdAt"`.

---

## 16. Populate vs $lookup

**Q: What's the difference between `.populate()` and `$lookup`? When is each used?**

**A:**

### `.populate()` — Mongoose-level join (multiple queries behind the scenes)
```javascript
// routes/suppliersRoutes.js — line ~728
Users.find(searchQueryforUser, { name: 1, email: 1, mobileNo: 1 })
  .populate({ path: "planId" })   // Joins plan collection by ObjectId ref
  .sort("-createdAt");
```
**When to use:** Simple joins where you just need to resolve a reference. Works with `ref` defined in schema.

### `$lookup` — MongoDB-level join (single query, server-side)
```javascript
// routes/userRoutes.js — Hot product suppliers
{
  $lookup: {
    from: "plan",
    localField: "planId",
    foreignField: "_id",
    as: "planId"
  }
}
```
**When to use:** Inside aggregation pipelines, complex filtering on joined data, when you need `$expr` or pipeline sub-stages.

### `.populate()` in cron job
```javascript
// helper/reset-email-limit.js
Users.find({ isAdmin: false }).populate("planId");
// Then loops through users to reset limits using plan.emailLimit
```

**Key difference:** `$lookup` is done on the MongoDB server (single round-trip). `.populate()` makes an additional query per populate call (Mongoose handles it). For simple refs, `.populate()` is cleaner. For aggregation pipelines, `$lookup` is the only option.

---

## 17. Soft Delete Pattern

**Q: How does this project implement soft deletes? Why not hard delete?**

**A:** Many models include a `deletedAt` field. Instead of removing the document, we set `deletedAt` to the current timestamp. All queries must filter `deletedAt: null` to exclude "deleted" records.

### Schema definition
```javascript
// models/grade.js, material-grade.js, equivalent-grade.js, plan.js, etc.
deletedAt: { type: Date, default: null }
```

### Query filtering
```javascript
// routes/productCategoryGradesRoutes.js — line ~99
Products.findOne({ url: productUrl, deletedAt: null });

// routes/suppliersRoutes.js — line ~648 (in aggregation)
Suppliers.aggregate([
  { $match: { deletedAt: null } },
  { $group: { _id: "$userId", count: { $sum: 1 } } }
]);

// routes/userRoutes.js — line ~1495
Users.find({ isAdmin: true, deletedAt: null });

// helper/newEmailAssignToSupplier.js — line 9
Users.find({ isAdmin: false, updatedAt: { $lte: date }, deletedAt: null });
```

**Why soft delete?**
1. **Audit trail** — You can see when something was deleted
2. **Recovery** — Can restore accidentally deleted records
3. **Referential integrity** — Other documents referencing the deleted one don't break
4. **Business requirement** — Suppliers/products that were once active may have historical email/RFQ data linked to them

---

## 18. Upsert Pattern

**Q: What is an upsert? Where is it used in this project?**

**A:** Upsert = "update if exists, insert if not." It's an atomic operation that prevents race conditions.

### Upsert in findOneAndUpdate
```javascript
// routes/emailLogic.js — lines 64-82
UserEmailStats.findOneAndUpdate(
  { userId: req.body.userId.toString().trim() },  // Filter
  {
    $set: updateObject,
    $setOnInsert: { userId: req.body.userId.toString().trim() }
  },
  { new: true, upsert: true }  // Create if not found
);
```
**Context:** Track email send/receive counts per user. First email for a user creates the stats doc; subsequent emails update it.

### Upsert in bulkWrite
```javascript
// routes/suppliersRoutes.js — lines 88-119
Suppliers.bulkWrite([
  {
    updateOne: {
      filter: {
        userId: user.userId,
        productId: req.body.productId,
        materialId: req.body.materialId,
        gradeId: req.body.gradeId[i]
      },
      update: {
        $set: {
          email: user.email,
          name: user.name,
          assignedEmailId: user.assignedEmailId,
          // ... more fields
        }
      },
      upsert: true  // Insert if no matching supplier-product combo exists
    }
  }
]);
```
**Context:** When a supplier lists products, this either creates a new listing or updates the existing one — prevents duplicate listings for the same product+material+grade combination.

---

## 19. Bulk Operations

**Q: What bulk operations are used and why?**

**A:**

### bulkWrite — Multiple operations in one call
```javascript
// routes/suppliersRoutes.js — lines 88-119
// Builds an array of operations, one per grade
const operations = req.body.gradeId.map(gradeId => ({
  updateOne: {
    filter: { userId, productId, materialId, gradeId },
    update: { $set: { ...supplierData } },
    upsert: true
  }
}));
Suppliers.bulkWrite(operations);
```
**Why:** A supplier may list 10+ grades at once. Instead of 10 separate network calls, one `bulkWrite` sends them all.

### insertMany — Batch insert
```javascript
// modules/admin/allModule/bullmq/allModule.logic.js
// BullMQ worker creating cartesian product mappings
const newData = newDataArray.filter(ele =>
  !existingData.some(e => /* matching conditions */)
);
if (newData.length > 0) {
  const inserted = await Grades.insertMany(newData);
  await AllModule.insertMany(inserted.map(e => ({
    productMaterialGradeId: e._id
  })));
}
```
**Context:** When a new material-grade is created, BullMQ workers generate all possible product-material-grade combinations. This can be 100+ records in one batch.

### updateMany — Batch update
```javascript
// routes/userRoutes.js — line ~1648
Users.updateMany(
  { isAdmin: false, "plan.name": planType },
  {
    "emailPlan.planType": emailPlan._id,
    "emailPlan.renewDate": renewDate,
    "emailPlan.currentEmailSent": 0,
    "emailPlan.userEmailLimit": emailPlan.emailLimit
  }
);
```
**Context:** When an admin changes a plan's email limit, all suppliers on that plan get updated at once.

### Cron batch update (mark emails as sent)
```javascript
// crons/cronJobs.js — lines 76-86
ScheduledEmails.updateMany(
  { _id: { $in: succeededIds } },
  { $set: { active: false, executedAt: IST_date }, $inc: { retry: 1 } }
);

AllEmailsModel.updateMany(
  { _id: { $in: allEmailsIds } },
  { $set: { emailStatus: "sent", sentDate: Date.now() } }
);
```

---

## 20. Text Search & Atlas Search

**Q: How is search implemented in this project?**

**A:** Two search mechanisms are used:

### 1. MongoDB Atlas Search ($search) — Full-text on News
```javascript
// routes/userRoutes.js — lines 1441-1478
News.aggregate([
  {
    $search: {
      index: "news_search_index",   // Pre-configured Atlas Search index
      text: {
        query: '"' + search + '"',  // Exact phrase in quotes
        path: { wildcard: "*" }     // Search all fields
      }
    }
  },
  {
    $project: {
      id: 1, news: 1, logo: 1, url: 1, title: 1,
      score: { $meta: "textScore" },  // Relevance score
      _id: 0
    }
  },
  { $limit: 50 }
]);
```
**Requires:** Atlas Search index named `news_search_index` configured in MongoDB Atlas.

### 2. $regex — Pattern matching across collections
```javascript
// routes/userRoutes.js — lines 1686-1717
// Search across 4 collections simultaneously
const params = {
  $or: [
    { name: { $regex: new RegExp(search, "i") } },
    { displayName: { $regex: new RegExp(search, "i") } },
    { url: { $regex: new RegExp(search, "i") } }
  ]
};

const [products, materials, productMaterials, grades] = await Promise.all([
  Products.aggregate([{ $match: params }, { $limit: 10 }]),
  Materials.aggregate([{ $match: params }, { $limit: 10 }]),
  ProductMaterial.aggregate([{ $match: params }, { $limit: 10 }]),
  Grades.aggregate([{ $match: params }, { $limit: 10 }])
]);
```
**Context:** Global search bar — searches products, materials, product-materials, and grades all at once with regex. Results are cached in Redis for 5 minutes.

### 3. Wildcard full-text index
```javascript
// models/AllEmails.js
AllEmailsSchema.index({ '$**': 'text' });
```
This creates a text index on every string field in the document. Useful for `$text: { $search: "keyword" }` queries.

---

## 21. Password Hashing with Static Methods

**Q: How are Mongoose static methods used for password handling?**

**A:** Static methods are functions attached to the Model (not to individual documents).

```javascript
// models/Users.js
const bcrypt = require('bcryptjs');

userSchema.statics.hashPassword = function(password) {
  return bcrypt.hashSync(password, SALT_HASH_LENGTH);
};

userSchema.statics.comparePassword = function(password, hash) {
  return bcrypt.compareSync(password, hash);
};
```

### Usage in routes:

**Registration — hashing:**
```javascript
// routes/userRoutes.js — user signup
const hashedPassword = Users.hashPassword(req.body.password);
let user = new Users({ ...userDetails, password: hashedPassword });
```

**Login — comparison:**
```javascript
// routes/userRoutes.js — login
const user = await Users.findOne({ email: userCred });
if (!Users.comparePassword(req.body.password, user.password)) {
  return res.status(401).json({ message: "Invalid credentials" });
}
```

**Password reset:**
```javascript
// routes/userRoutes.js — line ~1409
Users.findOneAndUpdate(
  { $or: [{ mobileNo: mobileNo }, { email: mobileNo }] },
  { $set: { password: Users.hashPassword(password) } },
  { new: false, upsert: false }
);
```

**Why static methods?**
- Encapsulates bcrypt logic in the model layer
- Can be called on the Model itself: `Users.hashPassword()`
- Keeps route handlers clean — they don't import bcrypt directly

---

## 22. countDocuments & Counting

**Q: How do you count documents efficiently in MongoDB?**

**A:**

### countDocuments — For filtered counts
```javascript
// modules/admin/email/services/list.js — line ~68
const total = await Emails.countDocuments(emailQuery);
```

### $count stage — Inside aggregation
```javascript
// modules/admin/Rfqs/controller/List.js — line ~53
RfqModel.aggregate([
  { $match: { createdAt: { $gte: daysAgo, $lte: tillDate } } },
  { $count: "TotalRfqs" }
]);
// Returns: [{ TotalRfqs: 150 }]
```

### $sum in $group — Count per category
```javascript
// routes/suppliersRoutes.js — line ~1105
Suppliers.aggregate([
  { $match: { userId: user.userId } },
  { $group: { _id: "$productId", total: { $sum: 1 } } }
]);
// Returns: [{ _id: "PROD001", total: 5 }, { _id: "PROD002", total: 3 }]
```

### Used together for pagination
```javascript
const [data, total] = await Promise.all([
  Model.find(query).skip(skip).limit(limit),
  Model.countDocuments(query)
]);
const totalPages = Math.ceil(total / limit);
```

**Note:** Avoid `.count()` — it's deprecated in Mongoose. Use `.countDocuments()` or `.estimatedDocumentCount()` (the latter doesn't accept a filter but is faster for getting total collection size).

---

## 23. Projection / .select()

**Q: How do you control which fields are returned from queries?**

**A:**

### Projection object (second parameter)
```javascript
// routes/userRoutes.js — line ~72
Users.find({}, { userId: 1 });                        // Include only userId

// routes/userRoutes.js — line ~563
Users.findOne(
  { userId: req.body.userId },
  { userId: 1, email: 1, _id: 0 }                    // Include userId, email; exclude _id
);
```

### .select() method
```javascript
// modules/admin/material/services/list.js
Materials.find({ active: true }).select(["_id", "materialId", "name"]);
```

### $project in aggregation
```javascript
// modules/admin/dashboard/services/list-top-10-supplier.js
{
  $project: {
    _id: 0,
    supplierEmail: "$_id",        // Rename field
    supplierName: "$userDetails.name",
    count: 1                      // Keep the count field
  }
}
```

### In $lookup sub-pipeline
```javascript
{
  $lookup: {
    from: "suppliers",
    pipeline: [
      { $match: { ... } },
      { $project: { userId: 1, gradeId: 1 } }  // Only fetch needed fields from joined collection
    ],
    as: "suppliers"
  }
}
```

**Why projection matters:** Reduces network bandwidth and memory usage. The Users model has 30+ fields — always select only what you need.

---

## 24. Enum Validation in Schema

**Q: How does Mongoose validate enum fields?**

**A:**

```javascript
// models/AllEmails.js
emailType: {
  type: String,
  enum: ['no_type', 'enquiry', 'supplier_email', 'admin_email', 'forwardEmail'],
  default: 'no_type'
}

status: {
  type: String,
  enum: ['inbox', 'approve', 'disapprove', 'block_by_admin', 'archive', 'trash', 'admin', 'ignored']
}

seenStatus: {
  type: String,
  enum: ['read', 'unread', 'none']
}

emailStatus: {
  type: String,
  enum: ['sent', 'scheduled', 'draft', 'review']
}
```

```javascript
// models/BlockEmailAndIp.js
blockType: {
  type: String,
  enum: ['email', 'domain'],
  required: true
}

status: {
  type: String,
  enum: ['temporaryBlock', 'permanentBlock'],
  required: true
}
```

**What happens if invalid value is set:** Mongoose throws a `ValidationError` before the document reaches MongoDB. The error message includes the allowed values.

**Where constants are defined:** `constants/` directory has separate files for email types, statuses, read statuses matching these enum values exactly.

---

## 25. Timestamps Option

**Q: How does Mongoose handle timestamps?**

**A:**

### Standard timestamps
```javascript
// models/grade.js, equivalent-grade.js, plan.js
{ timestamps: true }
// Automatically adds: createdAt, updatedAt (Date fields)
```

### Custom timestamp field names
```javascript
// models/AllEmails.js
{ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
```

### Manual timestamps (legacy models)
```javascript
// models/Users.js — handles timestamps manually
createdAt: { type: Date },
updatedAt: { type: Date }
```
Some older models set these manually in route handlers:
```javascript
user.updatedAt = Date.now();
await user.save();
```

---

## 26. Batch Processing in Cron Jobs

**Q: How does this project use cron jobs with MongoDB?**

**A:** Two cron systems exist:

### System 1: app.js crons (controlled by RUN_CRON env var)

**Every 30 seconds — Process scheduled emails:**
```javascript
// crons/cronJobs.js — line ~30
const pendingEmails = await ScheduledEmails.find({
  active: true,
  nextExecutionTime: { $lte: IST_date },
  retry: { $lte: 5 },
  executedAt: null
});

// Send each email, collect successes and failures
// Then batch update:
await ScheduledEmails.updateMany(
  { _id: { $in: succeeded } },
  { $set: { active: false, executedAt: IST_date }, $inc: { retry: 1 } }
);
await AllEmailsModel.updateMany(
  { _id: { $in: allEmailsIds } },
  { $set: { emailStatus: "sent", sentDate: Date.now() } }
);
```

**Daily 1 AM — Assign new emails to suppliers:**
```javascript
// helper/newEmailAssignToSupplier.js
const oldSuppliers = await Users.find({
  isAdmin: false,
  updatedAt: { $lte: oneMonthAgo },
  deletedAt: null
});

for (const supplier of oldSuppliers) {
  await Users.updateOne(
    { _id: supplier._id, deletedAt: null },
    { $set: { assignedEmailId: newEmail, updatedAt: Date.now() } }
  );
}
```

**Monthly 1st — Reset email limits:**
```javascript
// helper/reset-email-limit.js
const users = await Users.find({ isAdmin: false }).populate("planId");

for (const user of users) {
  user.emailPlan.currentEmailSent = 0;
  user.remainingEmailLimit = user.planId.emailLimit;
  await user.save();
}
```

### System 2: crons/luncher.js (Asia/Kolkata timezone)
- Daily midnight: `updateEmailRenewDate`
- Every 30 min: `notifyAdminUnregisteredUser`
- Every 50 min: `fetchBlogPost`
- Daily midnight/1AM/2AM: Sitemap generation

---

## 27. BullMQ + MongoDB — Background Workers

**Q: How does BullMQ interact with MongoDB in this project?**

**A:** BullMQ is used for background processing of cartesian-product data mappings when new materials/grades/products are created.

### 4 Queues
1. `PRODUCT_MATERIAL_MAP` — Map products to materials
2. `MATERIAL_GRADE_MAP` — Map material-grades to products
3. `GRADE_EQGRADE_MAP` — Map grades to equivalent grades
4. `PRODUCT_SUBPRODUCT_MAP` — Map products to sub-products

### Worker pattern
```javascript
// modules/admin/allModule/bullmq/allModule.logic.js

async function materialGradeMap(data) {
  const { gradeId, materialId } = data;

  // 1. Find existing mappings to avoid duplicates
  const existingData = await Grades.find({
    gradeModelId: new mongoose.Types.ObjectId(gradeId),
    materialId: materialId
  });

  // 2. Get all products for this material
  const products = await ProductMaterial.find({ materialId: materialId });

  // 3. Filter out already-existing combinations
  const newData = products.filter(product =>
    !existingData.some(e =>
      e.productId === product.productId &&
      e.materialId === materialId
    )
  ).map(product => ({
    gradeModelId: gradeId,
    productId: product.productId,
    materialId: materialId,
    // ... generate URL, name, etc.
  }));

  // 4. Batch insert new combinations
  if (newData.length > 0) {
    const inserted = await Grades.insertMany(newData);
    await AllModule.insertMany(
      inserted.map(e => ({ productMaterialGradeId: e._id }))
    );
  }
}
```

**Why BullMQ?** Creating a new material-grade triggers generation of hundreds of product-material-grade combinations. Running this synchronously would block the API response. BullMQ processes it in the background with `concurrency: 1` to prevent race conditions.

---

## 28. Full-Text Index

**Q: What is a wildcard text index and when would you use it?**

**A:**

```javascript
// models/AllEmails.js
AllEmailsSchema.index({ '$**': 'text' });
```

This creates a text index on **every string field** in the AllEmails collection. It allows MongoDB `$text` queries:

```javascript
// Hypothetical usage (actual code uses $regex):
AllEmails.find({ $text: { $search: "piping material quote" } });
```

**Trade-offs:**
- **Pros:** No need to specify individual fields; covers subject, body, sender name, company name, etc.
- **Cons:** Larger index size, slower writes, may match irrelevant fields

**In practice:** The project mostly uses `$regex` for search instead of `$text`, likely because `$regex` gives more control over which fields to search. The wildcard text index exists as a fallback for future use.

---

## 29. $expr — Expression Operator

**Q: What is $expr and when is it needed?**

**A:** `$expr` allows using aggregation expressions inside `$match`. It's required when you need to:
1. Compare two fields in the same document
2. Use variables from `$lookup`'s `let` clause
3. Apply functions like `$regexMatch` or `$toString`

### Using $expr with $lookup variables
```javascript
// routes/suppliersRoutes.js — line ~998
{
  $lookup: {
    from: "suppliers",
    let: { gradeIds: "$gradeId" },
    pipeline: [
      {
        $match: {
          $expr: { $in: ["$gradeId", "$$gradeIds"] }  // Compare field to variable
        }
      }
    ],
    as: "suppliers"
  }
}
```
**Why $expr:** Inside a `$lookup` pipeline, you can't directly reference `$$gradeIds` (a variable) without `$expr`. Regular `$match` operators don't understand pipeline variables.

### Using $expr with $regexMatch on numeric fields
```javascript
// modules/admin/plan/services/list.js
{
  $expr: {
    $regexMatch: {
      input: { $toString: "$emailLimit" },  // Convert number to string
      regex: new RegExp(search, "i")
    }
  }
}
```
**Why:** You can't use `$regex` on a Number field directly. `$expr` + `$toString` + `$regexMatch` converts the number to a string first, then applies regex.

---

## 30. $facet — Multiple Pipelines in One Query

**Q: What is $facet and how could it improve queries in this project?**

**A:** `$facet` runs multiple aggregation pipelines on the same input dataset in a single query. It's useful for getting paginated data AND total count in one call.

**Not currently used in the project**, but it could replace the common pattern of running two parallel queries:

### Current pattern (2 queries):
```javascript
const [emails, total] = await Promise.all([
  Emails.find(emailQuery).limit(perPage).skip(perPage * (page - 1)).sort(sortBy),
  Emails.countDocuments(emailQuery)
]);
```

### Improved pattern with $facet (1 query):
```javascript
Emails.aggregate([
  { $match: emailQuery },
  {
    $facet: {
      data: [
        { $sort: { createdAt: -1 } },
        { $skip: perPage * (page - 1) },
        { $limit: perPage }
      ],
      total: [
        { $count: "count" }
      ]
    }
  }
]);
// Returns: { data: [...emails], total: [{ count: 150 }] }
```

**Benefits:** Single database round-trip, consistent snapshot (both results from same point in time), reduces load.

---

## Quick Reference — All Files With MongoDB Queries

| File | Key MongoDB Operations |
|------|----------------------|
| `routes/userRoutes.js` | Registration, login, $or, $search, aggregation, updateMany, regex search |
| `routes/suppliersRoutes.js` | bulkWrite upsert, $group, $unwind, $lookup, $in, aggregation |
| `routes/emailLogic.js` | Upsert with $setOnInsert, findOne with projection |
| `routes/productCategoryGradesRoutes.js` | Soft delete filters, $not, $regex search across collections |
| `modules/admin/email/services/list.js` | $or with $regex, pagination, countDocuments, dynamic sort |
| `modules/admin/grade/services/` | CRUD with findByIdAndUpdate, find with options |
| `modules/admin/material-grade/services/` | Create with save(), update, uniqueness checks |
| `modules/admin/plan/services/list.js` | $expr + $regexMatch + $toString for numeric search |
| `modules/admin/dashboard/services/` | Top-10 suppliers aggregation, $unwind + $group + $lookup |
| `modules/admin/Rfqs/controller/List.js` | $count, $sample, $skip/$limit, date range $match |
| `modules/admin/user/services/` | updateOne for status toggle |
| `modules/admin/blockEmail/controller/` | Uniqueness check with $ne on _id, aggregation listing |
| `modules/admin/allModule/bullmq/` | insertMany, find + filter + insertMany pattern |
| `crons/cronJobs.js` | Scheduled email processing, updateMany with $set + $inc |
| `helper/newEmailAssignToSupplier.js` | Date-based find, updateOne with soft-delete check |
| `helper/reset-email-limit.js` | find + populate + loop save |
| `models/Users.js` | Static methods (hashPassword, comparePassword), schema with 30+ fields |
| `models/Suppliers.js` | Compound unique index, HotProductSuppliers |
| `models/Products.js` | 6 indexed fields, Products + SubProducts in one file |
| `models/AllEmails.js` | Wildcard text index, 6 enum fields, nested objects |
| `models/EmailLogic.js` | 3 schemas in one file (UserEmailStats, ScheduledEmails, Enquiries) |
| `models/BlockEmailAndIp.js` | 3 schemas (BlockEmail, BlockIp, LimitAndDuration) |
| `lib/dbConnection.js` | mongoose.createConnection() pattern |

---

## Bonus: Common Interview Follow-Up Questions

**Q: How would you optimize a slow MongoDB query?**
A: Check with `.explain("executionStats")`. Look for `COLLSCAN` (full scan) vs `IXSCAN` (index scan). Add indexes on fields used in `$match`, `$lookup.localField/foreignField`, and `$sort`. Use projections to limit returned fields.

**Q: What is the N+1 query problem and how does `.populate()` handle it?**
A: N+1 means one query to get the list, then N queries to resolve each reference. Mongoose's `.populate()` batches the N queries into one `{ _id: { $in: [...allIds] } }` query, making it 2 queries total (1+1, not 1+N).

**Q: When would you use an embedded document vs a referenced document?**
A: Embed when: the data is always accessed together (e.g., `emailPlan` inside Users). Reference when: the data is shared across collections (e.g., `planId` → Plan), or when the sub-document can grow unbounded (e.g., emails).

**Q: What is the 16MB document size limit and how does it affect design?**
A: MongoDB documents can't exceed 16MB. This project avoids this by: not storing email attachments in the document (uses S3), keeping arrays bounded, and using separate collections for one-to-many relationships (Suppliers, Emails).

**Q: How do you handle race conditions in MongoDB?**
A: This project uses: atomic operators (`$set`, `$inc`), `bulkWrite` with upsert (prevents duplicates), `findOneAndUpdate` (atomic read+write), and BullMQ with `concurrency: 1` for serialized processing.

---

## 31. Duplicate Key Error Handling (Error Code 11000)

**Q: How does MongoDB handle duplicate key violations? How does this project catch them?**

**A:** When you try to insert a document that violates a `unique` index, MongoDB throws an error with `code: 11000`. This project catches it explicitly:

```javascript
// routes/userRoutes.js — News creation (line ~1292)
let news = new News(news_body);
news.save((e) => {
  if (e.code === 11000) {
    return res.status(400).json({
      status: 0,
      message: "This title already exists"
    });
  }
});
```

**Where unique indexes exist that can trigger 11000:**
- `Users.userId` — prevents duplicate user IDs
- `Users.url` — prevents duplicate profile URLs
- `Products.productId`, `Products.url`, `Products.code` — prevent duplicate products
- `Grades.gradeId`, `Grades.url` — prevent duplicate grades
- `News.id` — prevents duplicate news articles
- `BlockEmailAndIp.email` / `BlockEmailAndIp.ipAddress` — prevents duplicate blocks
- `HotProductSuppliers` compound index `{userId, productId, materialId}` — prevents duplicate hot product entries

**Best practice:** Always handle `code: 11000` in your save/insert error handlers instead of doing a separate `findOne` check first (the separate check has a race condition — another request could insert between your check and your insert).

---

## 32. ObjectId vs String IDs — Design Trade-offs

**Q: This project uses both ObjectId and String-based IDs. Why? What are the trade-offs?**

**A:**

### String IDs (used for legacy/external-facing entities)
```javascript
// models/Products.js
productId: { type: String, required: true, index: true, unique: true }

// models/Users.js
userId: { type: String, index: true, unique: true, required: true }

// models/Grades.js
gradeId: { type: String, required: true, index: true, unique: true }
```

### ObjectId refs (used for internal relationships)
```javascript
// models/Users.js
planId: { type: Schema.Types.ObjectId, ref: 'plan' }

// models/Grades.js
gradeModelId: { type: Schema.Types.ObjectId, ref: "gradeModel" }
equivalentModelId: { type: Schema.Types.ObjectId, ref: "equivalentGrade" }

// models/material-grade.js
gradeModelId: { type: Schema.Types.ObjectId, ref: "gradeModel" }
equivalentGradeId: { type: Schema.Types.ObjectId, ref: "equivalentGrade" }
```

### Trade-offs

| Aspect | String ID | ObjectId |
|--------|----------|----------|
| Size | Variable (8-20+ bytes) | Fixed 12 bytes |
| Sorting | Alphabetical | Chronological (embeds timestamp) |
| `.populate()` | Cannot use | Works natively with `ref` |
| `$lookup` | Must match field types exactly | Native support |
| Human-readable | Yes (e.g., "USR001") | No (e.g., "507f1f77bcf86cd799439011") |
| URL-safe | Depends | Hex string, URL-safe |

### Why this project mixes both:
- **String IDs** (`productId`, `userId`, `gradeId`): Legacy convention, used in URL patterns and cross-collection queries where String matching is simpler
- **ObjectId refs** (`planId`, `gradeModelId`): Newer admin modules use ObjectId for proper `.populate()` and `$lookup` support

### Conversion when needed:
```javascript
// routes/userRoutes.js — line ~1818
planId: { $in: req.body.planId?.map((e) => new mongoose.Types.ObjectId(e)) }
```
String plan IDs from the request body must be converted to ObjectId for `$match`.

---

## 33. $replaceRoot and $mergeObjects

**Q: What is $replaceRoot and when is it used?**

**A:** `$replaceRoot` replaces the entire document with a specified sub-document or merged result. Used with `$mergeObjects` to flatten nested structures after `$lookup`.

```javascript
// modules/admin/allModule/bullmq/allModule.logic.js — MaterialGradeMap function
const pipeline = [
  {
    $match: { gradeModelId: new mongoose.Types.ObjectId(gradeId) }
  },
  {
    $lookup: {
      from: 'materials',
      localField: 'materialId',
      foreignField: 'materialId',
      as: 'material'
    }
  },
  { $unwind: '$material' },
  {
    $replaceRoot: {
      newRoot: {
        $mergeObjects: ['$$ROOT', { materialName: '$material.name' }]
      }
    }
  }
];
```

**What it does step by step:**
1. `$lookup` adds a `material` array to each document
2. `$unwind` converts that array to a single object
3. `$replaceRoot` + `$mergeObjects` takes the current document (`$$ROOT`) and merges in `materialName` from the joined material — the result is a flat document with `materialName` at the top level

**Alternative without $replaceRoot:** You could use `$addFields` instead:
```javascript
{ $addFields: { materialName: '$material.name' } }
```
But `$replaceRoot` is more powerful when you want to completely reshape the document structure.

---

## 34. Multiple Schemas in One File

**Q: Can you define multiple Mongoose models in a single file? How is it done in this project?**

**A:** Yes. This project defines multiple schemas and models in several files:

### EmailLogic.js — 4 schemas, 4 models
```javascript
// models/EmailLogic.js
const userEmailStatSchema = new Schema({...});
const emailSchema = new Schema({...});
const emailScheduleSchema = new Schema({...});
const EnquirySchema = new Schema({...});

const UserEmailStats = CONN_TO_DB.model("userEmailStats", userEmailStatSchema);
const UserEmails = CONN_TO_DB.model("userEmails", emailSchema);
const ScheduledEmails = CONN_TO_DB.model("scheduledEmails", emailScheduleSchema);
const Enquiries = CONN_TO_DB.model("enquires", EnquirySchema);

module.exports = { UserEmailStats, UserEmails, ScheduledEmails, Enquiries };
```

### BlockEmailAndIp.js — 3 schemas, 3 models
```javascript
// models/BlockEmailAndIp.js
const blockEmailSchema = new Schema({...});
const blockIpSchema = new Schema({...});
const limitAndDurationSchema = new Schema({...});

module.exports = {
  blockEmailModel: CONN_TO_DB.model("blockEmail", blockEmailSchema),
  blockIpModel: CONN_TO_DB.model("blockIpAddress", blockIpSchema),
  limitAndDuration: CONN_TO_DB.model("limitAndDuration", limitAndDurationSchema)
};
```

### Products.js — 2 schemas
```javascript
const Products = CONN_TO_DB.model('products', productSchema);
const SubProducts = CONN_TO_DB.model('subproducts', subProductSchema);
```

### Materials.js — 2 schemas
```javascript
const Materials = CONN_TO_DB.model('Materials', materialSchema);
const ProductMaterial = CONN_TO_DB.model('ProductMaterialMap', product_material_map_schema);
```

### Users.js — 2 schemas
```javascript
const Users = CONN_TO_DB.model("users", userSchema);
const Reviews = CONN_TO_DB.model("reviews", reviewSchema);
```

**When to use this pattern:** Group models that are closely related and always used together (e.g., email-related models). Avoid it for unrelated models — it makes imports confusing.

---

## 35. Collection Name Override (Third Argument)

**Q: What is the third argument in `CONN_TO_DB.model()` and when do you need it?**

**A:** By default, Mongoose pluralizes and lowercases the model name to create the collection name. The third argument explicitly sets the collection name:

```javascript
// Without third argument — Mongoose auto-names the collection
CONN_TO_DB.model("plan", planSchema);
// Creates collection: "plans" (auto-pluralized)

// With third argument — Explicit collection name
CONN_TO_DB.model("plan", planSchema, "plan");
// Creates collection: "plan" (no auto-pluralization)
```

### Used in this project:
```javascript
// models/equivalent-grade.js
CONN_TO_DB.model("equivalentGrade", equivalentGrade, "equivalentGrade");

// models/grade.js
CONN_TO_DB.model("gradeModel", gradeModel, "gradeModel");

// models/material-grade.js
CONN_TO_DB.model("materialGrade", materialGrade, "materialGrade");

// models/material-sub-product-product.js
CONN_TO_DB.model("materialSubProductProduct", materialSubProductProduct, "materialSubProductProduct");

// models/plan.js
CONN_TO_DB.model("plan", plan, "plan");

// models/email.js
CONN_TO_DB.model("email", email, "email");
```

**Why it matters:** Without the third argument, `"equivalentGrade"` model would create a collection named `"equivalentgrades"` (lowercased + pluralized). The admin modules query `from: "equivalentGrade"` in `$lookup`, so the collection name must match exactly.

**Common bug:** If you forget the third argument and your `$lookup` uses `from: "equivalentGrade"`, the join returns empty arrays because the actual collection is `"equivalentgrades"`.

---

## 36. Data Denormalization Pattern

**Q: What is denormalization? Where is it used in this project?**

**A:** Denormalization means storing the same data in multiple places for read performance (avoiding joins).

### Plan data copied to Users
```javascript
// models/Users.js — plan fields duplicated from Plan collection
planId:              { type: ObjectId, ref: "plan" },   // Reference
planName:            String,                             // Denormalized
totalEmailLimit:     Number,                             // Denormalized
remainingEmailLimit: Number,                             // Denormalized (+ modified)
totalProductLimit:   Number,                             // Denormalized
remainingProductLimit: Number,                           // Denormalized (+ modified)
planActivationDate:  Date,                               // Denormalized
planExpiryDate:      Date,                               // Denormalized
```

**Why:** Every RFQ distribution query needs to check a supplier's email limit and plan type. Joining Users → Plan for every query would be expensive. Instead, plan limits are copied to the User document when the plan is assigned.

### Supplier info duplicated from Users
```javascript
// models/Suppliers.js — user data copied
userId:          { type: String, index: true },
name:            { type: String },
email:           { type: String },
assignedEmailId: { type: String },
```

**Why:** Product listing pages need supplier name/email. Without denormalization, every product page would need a User lookup per supplier.

### Trade-off
- **Read performance:** Excellent — no joins needed for common queries
- **Write complexity:** When a plan changes, you must update all users on that plan:
```javascript
// routes/userRoutes.js — line ~1648
Users.updateMany(
  { isAdmin: false, "plan.name": planType },
  { "emailPlan.userEmailLimit": emailLimit }
);
```
If you forget this `updateMany`, data becomes inconsistent.

---

## 37. Nested/Dot Notation Queries

**Q: How do you query nested fields in MongoDB?**

**A:** Use dot notation to access fields inside embedded objects:

### Query nested object fields
```javascript
// routes/userRoutes.js — line ~1598
Users.updateMany(
  { isAdmin: false, "plan.name": planType },        // Query nested plan.name
  { "emailPlan.userEmailLimit": emailLimit }         // Update nested emailPlan.userEmailLimit
);
```

### Search inside nested senderDetails
```javascript
// modules/admin/email/services/list.js
{
  $or: [
    { "senderDetails.email": { $regex: new RegExp(search, "i") } },
    { "senderDetails.name": { $regex: new RegExp(search, "i") } },
    { "emailContent.subject": { $regex: new RegExp(search, "i") } }
  ]
}
```

### Update deeply nested fields
```javascript
// routes/userRoutes.js — line ~1648
Users.updateMany(
  { isAdmin: false, "plan.name": planType },
  {
    "emailPlan.planType": emailPlan._id,
    "emailPlan.renewDate": renewDate,
    "emailPlan.currentEmailSent": 0,
    "emailPlan.userEmailLimit": emailPlan.emailLimit
  }
);
```

**Important:** Dot notation in the update means "set this specific nested field." Without dot notation, `{ emailPlan: { currentEmailSent: 0 } }` would **replace the entire emailPlan object**, losing all other fields inside it.

---

## 38. $push with $each — Bulk Array Operations

**Q: How do you add multiple items to an array field at once?**

**A:** Use `$push` with `$each`:

```javascript
// routes/userRoutes.js — line ~514 (supplier profile update)
Users.findOneAndUpdate(
  { userId: userId },
  {
    $push: {
      certificates: { $each: certificateArray },
      factoryImages: { $each: factoryImageArray },
      productImages: { $each: productImageArray }
    }
  },
  { new: true }
);
```

**Without $each:** `$push: { certificates: singleItem }` adds one item.
**With $each:** `$push: { certificates: { $each: [item1, item2, item3] } }` adds multiple items in one atomic operation.

**Other array modifiers that work with $push:**
- `$slice` — Limit array size after push
- `$sort` — Sort array after push
- `$position` — Insert at specific index

---

## 39. Mongoose .lean() for Performance

**Q: What does `.lean()` do and when should you use it?**

**A:** `.lean()` returns plain JavaScript objects instead of Mongoose documents. This skips hydration (adding getters, setters, `.save()`, `.populate()` methods, etc.).

```javascript
// Used in read-only queries for performance
const users = await Users.find({ isAdmin: false }).lean();
// users[0].save() → ERROR (no .save() method)
// users[0] is a plain object → faster serialization, less memory
```

**When to use `.lean()`:**
- API responses where you just return JSON
- Read-only operations (no subsequent `.save()` calls)
- Large result sets where memory matters

**When NOT to use `.lean()`:**
- When you need to call `.save()` or instance methods on the result
- When you need Mongoose virtuals or getters
- When using `.populate()` and need to further modify populated docs

**In this project:** Used in `routes/rendered_page_methods.js` for server-rendered pages where the data is only read and serialized to HTML — never modified and saved back.

---

## 40. Mongoose Connection Events

**Q: How do you monitor MongoDB connection health in a Node.js app?**

**A:** Mongoose connection objects emit events you can listen to:

```javascript
// lib/dbConnection.js
const CONN_TO_DB = mongoose.createConnection(MONGODB_ADDRESS, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

CONN_TO_DB.on('connected', () => {
  console.log('MongoDB connected');
});

CONN_TO_DB.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

CONN_TO_DB.on('disconnected', () => {
  console.log('MongoDB disconnected');
});
```

**Connection options used in this project:**
- `useNewUrlParser: true` — Use the new MongoDB connection string parser (avoids deprecation warning)
- `useUnifiedTopology: true` — Use the new Server Discovery and Monitoring engine

**Note:** Both options are default `true` in Mongoose 6+. This project uses Mongoose 5.x where they must be set explicitly.

---

## 41. Conditional Schema Validation

**Q: Can Mongoose validate a field conditionally based on another field?**

**A:** Yes. This project uses conditional required validation:

```javascript
// models/BlockEmailAndIp.js
const blockEmailSchema = new Schema({
  status: {
    type: String,
    enum: ['temporaryBlock', 'permanentBlock'],
    required: true
  },
  duration: {
    type: Date,
    required: function() {
      return this.status === 'temporaryBlock';
      // duration is ONLY required when status is temporaryBlock
    }
  }
});
```

**How it works:** The `required` option accepts a function. `this` refers to the document being validated. If status is `'permanentBlock'`, `duration` is optional. If `'temporaryBlock'`, `duration` becomes required.

**Where it's used:** Block email/IP system — permanent blocks don't need an expiry date, but temporary blocks must have one.

---

## 42. Instance Methods vs Static Methods

**Q: What's the difference between instance methods and static methods in Mongoose?**

**A:**

### Static methods — Called on the Model class
```javascript
// models/Users.js
userSchema.statics.hashPassword = function(password) {
  return bcrypt.hashSync(password, SALT_HASH_LENGTH);
};

// Usage: No document needed
const hash = Users.hashPassword("mypassword");
```

### Instance methods — Called on a document
```javascript
// models/Users.js
userSchema.methods.comparePassword = function(password, hash) {
  return bcrypt.compareSync(password, hash);
};

// Usage: Requires a document
const user = await Users.findOne({ email });
const isMatch = user.comparePassword(inputPassword, user.password);
```

**Rule of thumb:**
- **Static** = utility functions that don't need a specific document (hashing, custom finders)
- **Instance** = functions that operate on a specific document's data (comparison, formatting)

---

## 43. Schema Default Value Pitfalls

**Q: What are common pitfalls with Mongoose default values?**

**A:** This project has a known bug in `models/material-grade.js`:

```javascript
// models/material-grade.js — BUGGY defaults
name:            { type: String, default: true },    // Bug: default should be "" not true
metaTitle:       { type: String, default: true },    // Bug: stores string "true"
code:            { type: String, default: true },    // Bug: stores string "true"
url:             { type: String, default: true },    // Bug: stores string "true"
metaDescription: { type: String, default: true },    // Bug: stores string "true"
keywords:        { type: [String], default: true },  // Bug: stores string "true"
description:     { type: String, default: true },    // Bug: stores string "true"
```

**What happens:** When `default: true` is set on a String field, Mongoose coerces `true` to the string `"true"`. New documents will have `name: "true"` instead of `name: ""`.

### Correct patterns for defaults:
```javascript
// String defaults
name: { type: String, default: '' }       // Empty string
name: { type: String, default: null }     // Null

// Array defaults
keywords: { type: [String], default: [] } // Empty array

// Date defaults
createdAt: { type: Date, default: Date.now }     // Function reference (called on create)
createdAt: { type: Date, default: Date.now() }   // PITFALL: called once at schema load time
```

**Date.now vs Date.now():**
- `default: Date.now` — function reference, called fresh for each document
- `default: Date.now()` — evaluated once when the schema is defined, all documents get the same date

This project has this issue in `models/Suppliers.js`:
```javascript
addedOn: { type: Date, default: Date.now(), index: true }
// All suppliers created after server restart share the same addedOn timestamp
```

---

## 44. Redis + MongoDB Caching Pattern

**Q: How does this project combine Redis and MongoDB for performance?**

**A:** Redis acts as a read-through cache in front of MongoDB:

### Search results caching
```javascript
// routes/userRoutes.js — Global search (simplified)
const cacheKey = `search:${search}`;
const cached = await redis.get(cacheKey);

if (cached) {
  return res.json(JSON.parse(cached));   // Cache HIT — skip MongoDB
}

// Cache MISS — query MongoDB
const [products, materials, grades] = await Promise.all([
  Products.aggregate([{ $match: params }, { $limit: 10 }]),
  Materials.aggregate([{ $match: params }, { $limit: 10 }]),
  Grades.aggregate([{ $match: params }, { $limit: 10 }])
]);

const result = { products, materials, grades };
await redis.setex(cacheKey, 300, JSON.stringify(result));  // Cache for 5 min
return res.json(result);
```

### Session storage (Redis instead of MongoDB)
```javascript
// lib/Authorisation.js
// Sessions stored in Redis, NOT MongoDB
const session = await redis.get(`session:${token}`);
// TTL: 2592000 seconds (30 days)
```

### OTP storage
```javascript
// Redis stores OTPs with 5-minute TTL
await redis.setex(`otp:${phone}`, 300, otp);
```

**Why Redis over MongoDB for these use cases:**
- **Sessions:** Redis is in-memory → sub-millisecond reads. MongoDB would add ~2-5ms per API call for auth
- **Search cache:** Avoid hitting 4 MongoDB collections on every keystroke
- **OTP:** Auto-expiry via TTL — no cron job needed to clean up expired OTPs

---

## 45. preserveNullAndEmptyArrays in $unwind

**Q: What does `preserveNullAndEmptyArrays` do in $unwind? What's the difference between true and false?**

**A:** After `$lookup`, the joined field is always an array. `$unwind` converts it to individual documents. The option controls what happens when the array is empty (no match found):

### `preserveNullAndEmptyArrays: false` (or omitted) — Acts like INNER JOIN
```javascript
// routes/userRoutes.js — Hot product suppliers
{
  $unwind: {
    path: "$userId",
    preserveNullAndEmptyArrays: false
  }
}
// Documents with NO matching user are REMOVED from results
```

### `preserveNullAndEmptyArrays: true` — Acts like LEFT JOIN
```javascript
{
  $unwind: {
    path: "$userDetails",
    preserveNullAndEmptyArrays: true
  }
}
// Documents with NO matching user STAY in results (with userDetails: null)
```

### Real project example:
```javascript
// modules/admin/dashboard/services/list-top-10-supplier.js
{
  $unwind: {
    path: "$userDetails",
    preserveNullAndEmptyArrays: false   // Skip emails from deleted/unknown users
  }
}
```

**Why `false` here:** The dashboard shows top 10 suppliers by email count. If a supplier was deleted, we don't want them in the ranking. `false` automatically excludes them without an extra `$match` stage.

---

## 46. $$NOW — System Variable for Current Time

**Q: What is `$$NOW` in MongoDB and how is it different from `new Date()` in JavaScript?**

**A:** `$$NOW` is a MongoDB aggregation system variable that returns the current datetime **on the server side** during pipeline execution. It's different from `new Date()` which runs in Node.js before the query is sent.

```javascript
// routes/userRoutes.js — line ~1825
{
  $addFields: {
    plainExpiresInDays: {
      $dateDiff: {
        startDate: "$$NOW",          // MongoDB server's current time
        endDate: "$planExpiryDate",
        unit: "day"
      }
    }
  }
}
```

**Why it matters:**
- `$$NOW` is consistent across all documents in the same pipeline execution — evaluated once
- `new Date()` is evaluated in Node.js before sending to MongoDB — there could be a time difference if the Node server and MongoDB server clocks differ
- `$$NOW` can be used inside `$match`, `$addFields`, `$project` without passing a variable

**Other MongoDB system variables:**
- `$$ROOT` — the current document (used with `$replaceRoot`)
- `$$CURRENT` — alias for the current document
- `$$REMOVE` — conditionally exclude a field

---

## 47. $meta — Text Score and Search Metadata

**Q: What does `$meta` do in MongoDB?**

**A:** `$meta` accesses metadata from special operations like text search and Atlas Search.

```javascript
// routes/userRoutes.js — line ~1461
{
  $project: {
    id: 1,
    news: 1,
    logo: 1,
    url: 1,
    title: 1,
    score: { $meta: "textScore" },   // Relevance score from $search
    _id: 0
  }
}
```

**What `textScore` returns:** A number indicating how relevant the document is to the search query. Higher = more relevant. This allows sorting results by relevance:

```javascript
// You could add this after $project:
{ $sort: { score: -1 } }   // Most relevant first
```

**Available $meta values:**
- `"textScore"` — relevance score from `$text` or `$search`
- `"searchScore"` — Atlas Search score
- `"indexKey"` — the index key used to match (debugging)

---

## 48. Callback vs Promise vs Async/Await Patterns

**Q: This project mixes callbacks, promises, and async/await for MongoDB operations. Explain each pattern.**

**A:** Three different patterns are used — this reflects the codebase evolving over time:

### Pattern 1: Callbacks (oldest code)
```javascript
// routes/userRoutes.js — line ~242 (user registration)
let user = new Users(userDetails);
user.save((e, response) => {
  if (e) return handleDBError(res, e);
  return res.json({ status: 1, data: response });
});
```

### Pattern 2: Promise .then/.catch
```javascript
// routes/userRoutes.js — login
Users.findOne(query, projection, (err, user) => {
  if (err) return handleDBError(res, err);
  // ... handle user
});
```

### Pattern 3: Async/Await (newer code)
```javascript
// modules/admin/grade/services/create.js
const create = async (req, res) => {
  try {
    const grade = new GradeModel({ name, code });
    await grade.save();
    return successResponse(res, grade);
  } catch (error) {
    return errorResponse(res, error);
  }
};
```

### Promise.all for parallel queries
```javascript
// routes/userRoutes.js — search across collections
const [products, materials, productMaterials, grades] = await Promise.all([
  Products.aggregate([{ $match: params }, { $limit: 10 }]),
  Materials.aggregate([{ $match: params }, { $limit: 10 }]),
  ProductMaterial.aggregate([{ $match: params }, { $limit: 10 }]),
  Grades.aggregate([{ $match: params }, { $limit: 10 }])
]);
```

**Interview tip:** The admin modules (`modules/admin/`) consistently use async/await (newer pattern). The route files (`routes/`) mix callbacks and async/await (legacy code). When asked about this, explain it as technical debt — the routes were written first with callbacks and haven't been fully migrated.

---

## 49. Mongoose useFindAndModify Option

**Q: What does `useFindAndModify: false` do?**

**A:**

```javascript
// routes/userRoutes.js — line ~534
Users.findByIdAndUpdate(
  req.body.userId,
  { $set: { permissions: req.body.permissions } },
  { new: true, useFindAndModify: false }
);
```

**Explanation:**
- Mongoose 5.x by default uses the MongoDB driver's `findAndModify()` command for `findOneAndUpdate/findByIdAndUpdate`
- `useFindAndModify: false` tells Mongoose to use the newer `findOneAndUpdate()` driver method instead
- The newer method is more predictable and doesn't have the confusing `findAndModify` semantics

**In Mongoose 6+:** `useFindAndModify` is removed. The newer behavior is the default. This project uses Mongoose 5.x, so it must set this explicitly to avoid deprecation warnings.

**Related option:** `{ new: true }` returns the **updated** document. Without it (or `{ new: false }`), the **original** document before update is returned.

---

## 50. Schema ref — How populate() Knows Where to Look

**Q: How does Mongoose `.populate()` know which collection to join?**

**A:** Through the `ref` field in the schema definition:

```javascript
// models/Users.js
planId: { type: Schema.Types.ObjectId, ref: 'plan' }
```

When you call:
```javascript
Users.find({}).populate({ path: "planId" });
```

Mongoose:
1. Reads `ref: 'plan'` from the schema
2. Finds the model registered as `'plan'` (via `CONN_TO_DB.model("plan", ...)`)
3. Collects all `planId` values from the user documents
4. Runs `Plan.find({ _id: { $in: [...allPlanIds] } })`
5. Replaces each user's `planId` (ObjectId) with the full Plan document

### Multiple refs in this project:
```javascript
// models/Grades.js
gradeModelId:     { type: ObjectId, ref: "gradeModel" }       // → gradeModel collection
equivalentModelId: { type: ObjectId, ref: "equivalentGrade" }  // → equivalentGrade collection

// models/material-grade.js
gradeModelId:      { type: ObjectId, ref: "gradeModel" }
equivalentGradeId: { type: ObjectId, ref: "equivalentGrade" }
```

**Important:** `ref` only works with ObjectId fields. String ID fields (like `productId`, `userId`) cannot use `.populate()` — that's why those require `$lookup` in aggregation pipelines.

---

## 51. Handling Optional/Dynamic Query Conditions

**Q: How do you build a query dynamically based on optional parameters?**

**A:** This project builds query objects conditionally before passing them to `find()`:

### Email listing — dynamic search + filter
```javascript
// modules/admin/email/services/list.js
let emailQuery = { deletedAt: null };     // Base filter (always applied)

// Conditionally add search
if (search) {
  emailQuery.$or = [
    { companyName: { $regex: new RegExp(search, "i") } },
    { receiverEmail: { $regex: new RegExp(search, "i") } },
    { "senderDetails.email": { $regex: new RegExp(search, "i") } }
  ];
}

// Conditionally add status filter
if (emailStatus) {
  emailQuery.emailStatus = emailStatus;
}

// Conditionally add type filter
if (emailType) {
  emailQuery.emailType = emailType;
}

// Single query with all conditions
const emails = await Emails.find(emailQuery).limit(perPage).skip(skip).sort(sortBy);
```

### Supplier search — build query piece by piece
```javascript
// routes/suppliersRoutes.js
let searchQueryforUser = {};

if (search) {
  searchQueryforUser.$or = [
    { name: { $regex: new RegExp(search, "i") } },
    { email: { $regex: new RegExp(search, "i") } }
  ];
}

if (planType) {
  searchQueryforUser["plan.name"] = planType;
}

if (status !== undefined) {
  searchQueryforUser.active = status;
}
```

### Dynamic sort based on email status
```javascript
// modules/admin/email/services/list.js
let sortBy = {};
switch (emailStatus) {
  case "inbox":     sortBy = { createdAt: -1 }; break;
  case "sent":      sortBy = { sentDate: -1 };  break;
  case "scheduled": sortBy = { scheduleOn: -1 }; break;
  default:          sortBy = { updatedAt: -1 };
}
```

**Why this pattern:** Instead of writing separate queries for every combination of filters, you build one query object and MongoDB handles the filtering. This scales well — adding a new filter is just one `if` block.

---

## 52. $$ROOT vs $$CURRENT — Aggregation Document References

**Q: What is $$ROOT in aggregation pipelines?**

**A:** `$$ROOT` refers to the top-level document currently being processed in the pipeline. Used with `$replaceRoot` and `$mergeObjects`.

```javascript
// modules/admin/allModule/bullmq/allModule.logic.js
{
  $replaceRoot: {
    newRoot: {
      $mergeObjects: ['$$ROOT', { materialName: '$material.name' }]
    }
  }
}
```

**What this does:**
- `$$ROOT` = the entire current document (all fields)
- `$mergeObjects` = combine `$$ROOT` with a new object `{ materialName: ... }`
- Result: original document + materialName added at top level

**Without $$ROOT** you'd need to manually `$project` every field:
```javascript
// Tedious alternative
{ $project: { field1: 1, field2: 1, field3: 1, ..., materialName: '$material.name' } }
```

---

## 53. Mongoose Schema Types — Complete Reference

**Q: What field types does Mongoose support? Which are used in this project?**

**A:**

| Type | Example from Project | File |
|------|---------------------|------|
| `String` | `name: { type: String }` | All models |
| `Number` | `emailSendCount: { type: Number, default: 0 }` | `EmailLogic.js` |
| `Boolean` | `active: { type: Boolean, default: true }` | `Users.js`, `Products.js` |
| `Date` | `sentDate: { type: Date, indexed: true }` | `AllEmails.js` |
| `ObjectId` | `planId: { type: Schema.Types.ObjectId, ref: 'plan' }` | `Users.js` |
| `Array` | `receiverEmail: [String]` | `email.js` |
| `Array of Objects` | `faqs: [{ question: String, answer: String }]` | `Products.js`, `Grades.js` |
| `Nested Object` | `senderDetails: { name: String, email: String }` | `AllEmails.js` |
| `Mixed/Object` | `address: { type: Object, default: {} }` | `Users.js` |

### Common validators used:
```javascript
{
  type: String,
  required: true,          // Must be provided
  unique: true,            // Creates unique index
  index: true,             // Creates regular index
  default: '',             // Default value
  enum: ['a', 'b', 'c'],  // Allowed values
  ref: 'modelName'         // For .populate()
}
```

---

## 54. MongoDB Connection Pooling

**Q: What is connection pooling and how does Mongoose handle it?**

**A:** Connection pooling maintains a set of open connections to MongoDB, reusing them for new requests instead of opening/closing connections per query.

```javascript
// lib/dbConnection.js
const CONN_TO_DB = mongoose.createConnection(MONGODB_ADDRESS, {
  useNewUrlParser: true,
  useUnifiedTopology: true
  // Default pool size: 5 connections
});
```

**Default behavior:**
- Mongoose creates a pool of **5 connections** per `createConnection()`
- When a query comes in, it uses an available connection from the pool
- If all 5 are busy, the query waits until one is free
- Connections are reused — no overhead of TCP handshake per query

**When to increase pool size:**
```javascript
mongoose.createConnection(url, {
  maxPoolSize: 10   // Increase for high-concurrency servers
});
```

**In this project:** Default pool size (5) is used. Since the backend handles moderate traffic and cron jobs run sequentially, 5 connections are sufficient. If the cron system and API both hit the database heavily at the same time, increasing to 10-20 could help.

---

## 55. MongoDB Transactions — Why This Project Doesn't Use Them

**Q: Does MongoDB support transactions? Why doesn't this project use them?**

**A:** MongoDB supports multi-document ACID transactions since v4.0 (replica sets) and v4.2 (sharded clusters).

**What a transaction looks like:**
```javascript
const session = await mongoose.startSession();
session.startTransaction();

try {
  await Users.updateOne({ _id: userId }, { $set: { planId } }, { session });
  await Suppliers.updateMany({ userId }, { $set: { planName } }, { session });
  await session.commitTransaction();
} catch (error) {
  await session.abortTransaction();   // Rollback everything
} finally {
  session.endSession();
}
```

**Why this project doesn't use transactions:**
1. **Single-document atomicity** is sufficient for most operations — MongoDB guarantees that a single `updateOne()` or `findOneAndUpdate()` is atomic
2. **Denormalization** reduces the need for multi-document updates — plan data is copied to the User doc, not joined
3. **Eventual consistency** is acceptable — when a plan changes, `updateMany()` on users may take time, but this is handled by crons
4. **No replica set required** — transactions need a replica set. This project may run a standalone MongoDB
5. **BullMQ** handles complex multi-step operations (grade mapping) with retry logic instead of transactions

**When transactions would help:**
- If the email send + status update in `crons/cronJobs.js` needs to be all-or-nothing
- If user registration + supplier creation + plan assignment must be atomic
- Currently these are handled with error checking and retry logic instead

---

## 56. explain() — Debugging Slow Queries

**Q: How do you analyze and debug a slow MongoDB query?**

**A:** Use `.explain()` to see how MongoDB executes a query:

```javascript
// Debug example (not in production code)
const result = await Users.find({
  isAdmin: false,
  "plan.name": "gold",
  remainingEmailLimit: { $gt: 0 }
}).explain("executionStats");
```

**Key fields to check in output:**

| Field | Good Value | Bad Value |
|-------|-----------|-----------|
| `winningPlan.stage` | `IXSCAN` (index scan) | `COLLSCAN` (full scan) |
| `totalDocsExamined` | Close to `nReturned` | Much higher than `nReturned` |
| `executionTimeMillis` | < 100ms | > 1000ms |
| `indexBounds` | Shows index being used | Empty |

**Common fixes for slow queries in this project:**
1. Add index on `"plan.name"` if filtering by plan type frequently
2. Compound index `{ isAdmin: 1, "plan.name": 1, remainingEmailLimit: 1 }` for the common supplier filter
3. Use `$project` early in aggregation pipelines to reduce document size
4. Use `.lean()` for read-only queries
5. Add `.limit()` to prevent unbounded result sets

---

## 57. Mongoose Middleware (Pre/Post Hooks)

**Q: What are Mongoose pre/post hooks? Are they used in this project?**

**A:** Mongoose middleware (hooks) are functions that execute before or after certain operations (save, validate, remove, find).

**This project doesn't use hooks extensively**, but here's how they could be applied to existing patterns:

### Potential use — Auto-hash password before save
```javascript
// Instead of manually calling Users.hashPassword() in routes:
userSchema.pre('save', function(next) {
  if (this.isModified('password')) {
    this.password = bcrypt.hashSync(this.password, SALT_HASH_LENGTH);
  }
  next();
});
```

### Potential use — Auto-set updatedAt
```javascript
userSchema.pre('findOneAndUpdate', function(next) {
  this.set({ updatedAt: Date.now() });
  next();
});
```

### Potential use — Soft delete middleware
```javascript
// Auto-filter deletedAt: null on all find queries
gradeSchema.pre(/^find/, function(next) {
  this.where({ deletedAt: null });
  next();
});
```

**Why this project doesn't use hooks:**
- Password hashing is done explicitly via static method — more visible/debuggable
- Soft delete filtering is done manually in each query — more explicit control
- The codebase was built by multiple developers — explicit > implicit for team readability

---

## 58. Aggregation Pipeline Optimization Tips

**Q: How do you optimize aggregation pipelines? What are the best practices?**

**A:** Based on patterns in this project:

### 1. Put $match as early as possible
```javascript
// GOOD — filter first, then join
[
  { $match: { productId: id, materialId: id } },   // Reduces docs before $lookup
  { $lookup: { from: "users", ... } }
]

// BAD — join first, then filter (processes all docs)
[
  { $lookup: { from: "users", ... } },
  { $match: { productId: id } }
]
```

### 2. Use $project before $lookup to reduce document size
```javascript
// GOOD
[
  { $match: { ... } },
  { $project: { userId: 1, gradeId: 1 } },    // Only keep needed fields
  { $lookup: { from: "users", ... } }
]
```

### 3. Use pipeline $lookup with internal $match
```javascript
// GOOD — filtering happens inside MongoDB during the join
{
  $lookup: {
    from: "users",
    let: { uid: "$userId" },
    pipeline: [
      { $match: { $expr: { $eq: ["$userId", "$$uid"] }, active: true } }
    ],
    as: "userDetails"
  }
}
```

### 4. Avoid $skip + $limit without $sort
```javascript
// BAD — results may vary between executions
[{ $skip: 10 }, { $limit: 10 }]

// GOOD — consistent ordering
[{ $sort: { createdAt: -1 } }, { $skip: 10 }, { $limit: 10 }]
```

### 5. Use $count instead of fetching all docs to count
```javascript
// GOOD
[{ $match: query }, { $count: "total" }]

// BAD
const docs = await Model.find(query);
const total = docs.length;   // Loads ALL docs into memory
```

---

## 59. MongoDB Data Types — ObjectId Internals

**Q: What is an ObjectId? What information does it contain?**

**A:** ObjectId is MongoDB's default `_id` type — a 12-byte unique identifier.

### Structure (12 bytes):
```
|  4 bytes   |  5 bytes    | 3 bytes  |
| timestamp  | random      | counter  |
```

- **Bytes 1-4:** Unix timestamp (seconds since epoch) — when the document was created
- **Bytes 5-9:** Random value (unique per machine/process)
- **Bytes 10-12:** Incrementing counter (starts from random value)

### Extract timestamp from ObjectId
```javascript
const mongoose = require('mongoose');
const id = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
console.log(id.getTimestamp());
// Output: 2012-10-17T20:46:22.000Z
```

### Used in this project for:
```javascript
// Converting string to ObjectId for aggregation queries
new mongoose.Types.ObjectId(planIdString)

// Comparing ObjectIds
user.planId.equals(otherPlanId)   // Correct
user.planId === otherPlanId       // WRONG — compares references, not values
```

**Why ObjectId over UUID:**
- Naturally sortable by creation time (no need for `createdAt` index for time-based sorting)
- Smaller (12 bytes vs 16 bytes for UUID)
- Built into MongoDB — no external library needed

---

## 60. Common MongoDB Anti-Patterns Found in This Project

**Q: What MongoDB anti-patterns exist in this project and how would you fix them?**

**A:**

### 1. Loop-based individual updates (N+1 write problem)
```javascript
// helper/reset-email-limit.js — ANTI-PATTERN
const users = await Users.find({ isAdmin: false }).populate("planId");
for (const user of users) {
  user.emailPlan.currentEmailSent = 0;
  user.remainingEmailLimit = user.planId.emailLimit;
  await user.save();   // N individual writes!
}
```
**Fix:** Use `bulkWrite()` with conditional update based on plan:
```javascript
const plans = await Plan.find({ isActive: true });
for (const plan of plans) {
  await Users.updateMany(
    { planId: plan._id, isAdmin: false },
    { $set: { "emailPlan.currentEmailSent": 0, remainingEmailLimit: plan.emailLimit } }
  );
}
```

### 2. Double $limit in pagination
```javascript
// modules/admin/Rfqs/controller/List.js — ANTI-PATTERN
[
  { $match: { status: true } },
  { $sort: { createdAt: -1 } },
  { $limit: 100 },                    // First limit: hard cap
  { $skip: (page - 1) * limit },      // Then skip
  { $limit: limit }                    // Then limit again
]
```
**Issue:** If page * limit > 100, you get 0 results. This silently breaks after page 10 (if limit=10).

### 3. `Date.now()` as default (evaluated once)
```javascript
// models/Suppliers.js — ANTI-PATTERN
addedOn: { type: Date, default: Date.now(), index: true }
```
**Fix:** Use function reference: `default: Date.now` (without parentheses)

### 4. `default: true` on String fields
```javascript
// models/material-grade.js — ANTI-PATTERN
name: { type: String, default: true }   // Stores "true" as string
```
**Fix:** `default: ''` or `default: null`

### 5. Missing error handling on `.save()` in async context
```javascript
// Some routes use callback-style save without try/catch
user.save((e, response) => { ... });
// If this is inside an async function, unhandled promise rejection is possible
```
**Fix:** Use `await user.save()` inside `try/catch`

---

## Quick Summary — All 60 Topics by Category

### Schema & Design (Topics 2, 3, 24, 25, 32, 34, 35, 36, 41, 43, 50, 53)
Schema definition, field types, indexing, enums, timestamps, ObjectId vs String, multiple schemas per file, collection naming, denormalization, conditional validation, defaults, refs

### CRUD Operations (Topics 4, 5, 6, 7, 18, 19)
Create (save/create/insertMany), Read (find/findOne/findById), Update (findOneAndUpdate/updateOne/updateMany), Delete (deleteMany/remove), Upsert, Bulk ops

### Aggregation Framework (Topics 8, 9, 10, 11, 12, 29, 30, 33, 45, 46, 47, 52, 58)
Pipeline stages, $lookup joins, $group/$unwind, $dateDiff, $sample, $expr, $facet, $replaceRoot, preserveNullAndEmptyArrays, $$NOW, $meta, $$ROOT, optimization

### Query & Update Operators (Topics 13, 14, 37, 38)
$or/$in/$ne/$regex/$gt/$lte/$not, $set/$inc/$push/$setOnInsert, dot notation, $each

### Performance (Topics 15, 16, 22, 23, 39, 44, 54, 56)
Pagination, populate vs $lookup, counting, projection, .lean(), Redis caching, connection pooling, explain()

### Patterns & Architecture (Topics 1, 17, 21, 26, 27, 28, 31, 40, 42, 48, 49, 51, 55, 57, 59, 60)
Named connection, soft delete, password hashing, cron jobs, BullMQ, text index, duplicate handling, connection events, static/instance methods, callbacks vs async, useFindAndModify, dynamic queries, transactions, hooks, ObjectId internals, anti-patterns

---
---

# Section B: MongoDB Optimizations — What We Did & What We Can Improve

This section covers every optimization that already exists in the project and concrete improvements that can be made. Useful for interviews when asked: *"What optimizations have you done?"* and *"What would you improve?"*

---

## PART 1: Optimizations Already Done in This Project

### OPT-1. Strategic Indexing on All Foreign Keys

**What we did:** Every field used in `$match`, `$lookup`, or `find()` conditions is indexed.

```javascript
// models/Suppliers.js — All join fields indexed
userId:     { type: String, index: true }
productId:  { type: String, index: true }
materialId: { type: String, index: true }
gradeId:    { type: String, index: true }

// models/Products.js — Primary key + URL indexed and unique
productId: { type: String, required: true, index: true, unique: true }
url:       { type: String, index: true, required: true, unique: true }
code:      { type: String, default: null, index: true, unique: true }

// models/Users.js
userId:          { type: String, index: true, unique: true }
email:           { type: String, index: true }
mobileNo:        { type: String, index: true }
assignedEmailId: { type: String, index: true }
name:            { type: String, index: true }
```

**Impact:** Without these indexes, every `$lookup` and `.find()` would do a COLLSCAN (full collection scan). With 10,000+ suppliers and 1,000+ products, this would mean seconds per query instead of milliseconds.

**Interview answer:** *"We indexed every foreign key field and all fields used in query conditions. This ensures all find operations and aggregation $match stages use IXSCAN instead of COLLSCAN."*

---

### OPT-2. Compound Unique Index on HotProductSuppliers

**What we did:** Created a compound unique index to prevent duplicate entries AND speed up multi-field lookups.

```javascript
// models/Suppliers.js — HotProductSuppliers
HotProductSuppliersSchema.index(
  { userId: 1, productId: 1, materialId: 1 },
  { unique: true }
);
```

**Why it matters:**
- One query with 3 conditions uses a single index scan instead of intersection of 3 separate indexes
- Uniqueness is enforced at the database level — no race conditions
- Order matters: `{ userId, productId, materialId }` also supports queries on `{ userId }` and `{ userId, productId }` (left-prefix rule)

---

### OPT-3. Redis Caching at Multiple Layers

**What we did:** Implemented a multi-tier Redis caching strategy with different TTLs for different data types.

| Cache Layer | Key Pattern | TTL | What's Cached | File |
|-------------|-----------|-----|---------------|------|
| **Sessions** | `{sessionId}` | 30 days | User auth data | `lib/Authorisation.js` |
| **OTP** | `{phoneNo}` | 5 min | OTP codes | `routes/userRoutes.js` |
| **Search** | `search_result_\|_{term}` | 5 min | Product/material/grade results | `routes/productCategoryGradesRoutes.js` |
| **Product arrays** | `product_id_array` | 24 hours | Sorted product lists | `routes/rendered_page_methods.js` |
| **Grade arrays** | `grade_id_array_\|_{code}` | 24 hours | Grade data per code | `routes/rendered_page_methods.js` |
| **SubProduct arrays** | `sub_product_id_array` | 24 hours | SubProduct lists | `routes/rendered_page_methods.js` |
| **Supplier rotation** | `prev_supplier_shown_\|_{gradeId}_\|_{sessionId}` | 2 min | Previously shown suppliers | `routes/productCategoryGradesRoutes.js` |
| **IP rate limiting** | `IP:{address}` | Dynamic | Request count per IP | `modules/admin/email/services/checkBlockEmailsAndIps.js` |
| **Blog data** | `blog_section` | Cron-refreshed | Blog posts | `routes/rendered_page_methods.js` |
| **Homepage RFQs** | `homepage_rfq_data` | Cron-refreshed | RFQ display data | `routes/rendered_page_methods.js` |

**Impact:** The search endpoint gets ~300 req/min. Without Redis cache, that's 300×4 = 1,200 MongoDB aggregate calls per minute across 4 collections. With 5-minute cache, repeated searches hit Redis (sub-millisecond) instead.

**Interview answer:** *"We use Redis as a read-through cache with tiered TTLs — 5 minutes for search results, 24 hours for product catalog data, and 30 days for sessions. This reduced MongoDB load by ~80% for read-heavy endpoints."*

---

### OPT-4. Data Denormalization for Read Performance

**What we did:** Copied frequently accessed data into the User document to avoid joins on every request.

```javascript
// models/Users.js — Plan data denormalized
planId:              { type: ObjectId, ref: "plan" },  // Source reference
planName:            String,                            // Copied from Plan
totalEmailLimit:     Number,                            // Copied from Plan
remainingEmailLimit: Number,                            // Modified locally
planExpiryDate:      Date,                              // Copied from Plan
```

**Where it helps:**
- RFQ distribution (`crons/cronJobs.js`) checks `remainingEmailLimit > 0` without joining Plan
- Hot product suppliers pipeline checks `planExpiryDate` without a second `$lookup`
- Supplier listing pages show plan info without joining

**Trade-off managed by:** `updateMany()` to sync when admin changes a plan:
```javascript
Users.updateMany(
  { isAdmin: false, "plan.name": planType },
  { "emailPlan.userEmailLimit": emailLimit }
);
```

---

### OPT-5. Projection — Fetching Only Needed Fields

**What we did:** Used field projection in most queries to reduce data transfer.

```javascript
// routes/productCategoryGradesRoutes.js — Only needed fields
Products.find(searchQuery, {
  productId: 1, name: 1, url: 1, title: 1, keywords: 1,
  h2: 1, h1: 1, meta: 1, logo: 1, materials: 1,
  showInMiddle: 1, description: 1, code: 1, active: 1, faqs: 1
});

// routes/userRoutes.js — Minimal projection
Users.findOne(
  { userId: req.body.userId },
  { userId: 1, email: 1, _id: 0 }
);

// $project in aggregation sub-pipeline
{ $project: { userId: 1, gradeId: 1 } }
```

**Impact:** The Users model has 50+ fields. Fetching all of them for a simple check wastes bandwidth and memory. Projection cuts response size by 70-90%.

---

### OPT-6. bulkWrite for Batch Upserts

**What we did:** Used `bulkWrite()` instead of individual `save()` calls for supplier product listings.

```javascript
// routes/suppliersRoutes.js — One network call for 10+ grades
const operations = req.body.gradeId.map(gradeId => ({
  updateOne: {
    filter: { userId, productId, materialId, gradeId },
    update: { $set: { ...supplierData } },
    upsert: true
  }
}));
await Suppliers.bulkWrite(operations);
```

**Before (slow):** 10 grades = 10 separate `updateOne()` calls = 10 network round-trips
**After (fast):** 10 grades = 1 `bulkWrite()` call = 1 network round-trip

---

### OPT-7. Promise.all for Parallel MongoDB Queries

**What we did:** Run independent queries in parallel instead of sequentially.

```javascript
// routes/userRoutes.js — Search across 4 collections simultaneously
const [products, materials, productMaterials, grades] = await Promise.all([
  Products.aggregate([{ $match: params }, { $limit: 10 }]),
  Materials.aggregate([{ $match: params }, { $limit: 10 }]),
  ProductMaterial.aggregate([{ $match: params }, { $limit: 10 }]),
  Grades.aggregate([{ $match: params }, { $limit: 10 }])
]);
```

**Before (sequential):** 4 queries × ~50ms each = ~200ms
**After (parallel):** 4 queries running simultaneously = ~50ms total (limited by slowest query)

---

### OPT-8. $match Before $lookup in Pipelines

**What we did:** Filter documents before joining — reduces the number of documents that need to be joined.

```javascript
// routes/userRoutes.js — Hot product suppliers
HotProductSuppliers.aggregate([
  { $match: { productId, materialId } },          // Filter FIRST
  { $lookup: { from: "users", pipeline: [...] } } // Then join (only matching docs)
]);
```

**Impact:** If HotProductSuppliers has 10,000 docs but only 50 match the product+material combo, the `$lookup` runs on 50 docs instead of 10,000.

---

### OPT-9. Pipeline $lookup with Internal Filtering

**What we did:** Used nested pipeline inside `$lookup` to filter joined data at the database level.

```javascript
// routes/userRoutes.js — Only join active users with remaining email quota
{
  $lookup: {
    from: "users",
    localField: "userId",
    foreignField: "userId",
    as: "userId",
    pipeline: [
      { $match: { remainingEmailLimit: { $gt: 0 } } },   // Filter inside join
      { $match: { plainExpiresInDays: { $gt: 0, $lte: 75 } } }
    ]
  }
}
```

**Without internal filtering:** Join ALL users, then filter → transfers unnecessary data
**With internal filtering:** Only matching users are joined → minimal data transfer

---

### OPT-10. BullMQ for Async Background Processing

**What we did:** Offloaded heavy cartesian-product generation to background workers.

```javascript
// modules/admin/allModule/bullmq/ — 4 queues
PRODUCT_MATERIAL_MAP    → creates product-material combinations
MATERIAL_GRADE_MAP      → creates material-grade-product combinations
GRADE_EQGRADE_MAP       → creates equivalent grade mappings
PRODUCT_SUBPRODUCT_MAP  → creates product-subproduct combinations
```

**Before:** Creating a new material-grade would synchronously generate 100+ product-material-grade records → API response time: 5-10 seconds
**After:** API responds immediately, BullMQ processes in background with `concurrency: 1` → API response: <200ms

---

### OPT-11. $sample for Random Selection (Instead of JS Randomization)

**What we did:** Used MongoDB's built-in `$sample` for random document selection.

```javascript
// modules/admin/Rfqs/controller/List.js
{ $sample: { size: 5 } }
```

**Before (JS approach):** Fetch ALL active RFQs → shuffle in JS → take 5 → wastes memory
**After ($sample):** MongoDB randomly picks 5 from the filtered set → efficient, no data overfetch

---

### OPT-12. updateMany for Batch Plan Updates

**What we did:** When admin changes a plan, update all affected users in one operation.

```javascript
// routes/userRoutes.js
Users.updateMany(
  { isAdmin: false, "plan.name": planType },
  {
    "emailPlan.planType": emailPlan._id,
    "emailPlan.renewDate": renewDate,
    "emailPlan.currentEmailSent": 0,
    "emailPlan.userEmailLimit": emailPlan.emailLimit
  }
);
```

**Before:** Loop through each user and `.save()` individually → N writes
**After:** Single `updateMany()` → 1 write operation affecting N documents

---

### OPT-13. Atlas Search Index for Full-Text News Search

**What we did:** Used MongoDB Atlas Search instead of regex for news articles.

```javascript
// routes/userRoutes.js — $search with Atlas index
{
  $search: {
    index: "news_search_index",
    text: {
      query: '"' + search + '"',
      path: { wildcard: "*" }
    }
  }
}
```

**$regex approach:** Does a full collection scan (can't use index for `$regex` without anchor `^`)
**Atlas Search:** Uses an inverted index — O(log n) lookup instead of O(n) scan

---

### OPT-14. Wildcard Text Index on AllEmails

**What we did:** Created a text index on all string fields for future full-text search.

```javascript
// models/AllEmails.js
AllEmailsSchema.index({ '$**': 'text' });
```

This allows efficient `$text` queries across subject, body, sender name, company name, etc. without specifying each field.

---

## PART 2: What We Can Improve (With Code Examples)

### IMP-1. Add .lean() to All Read-Only Queries [HIGH IMPACT]

**Current state:** The project has **ZERO** `.lean()` calls. Every query returns full Mongoose documents with methods, getters, and change tracking overhead.

**Where to add it:**

```javascript
// routes/productCategoryGradesRoutes.js — Product pages (read-only)
// BEFORE:
let products = await Products.find(searchQuery, projection);
// AFTER:
let products = await Products.find(searchQuery, projection).lean();

// routes/rendered_page_methods.js — All SSR page data
// BEFORE:
let grade_data = await Grades.findOne({ url: gradeUrl });
// AFTER:
let grade_data = await Grades.findOne({ url: gradeUrl }).lean();

// modules/admin/email/services/list.js — Email listing
// BEFORE:
const emails = await Emails.find(emailQuery).limit(perPage).skip(skip).sort(sortBy);
// AFTER:
const emails = await Emails.find(emailQuery).limit(perPage).skip(skip).sort(sortBy).lean();
```

**Impact estimate:** 2-5x faster serialization, 40-60% less memory per query on large result sets.

**Where NOT to add it:** `helper/reset-email-limit.js` — because it calls `user.save()` after modification (needs Mongoose document).

---

### IMP-2. Fix N+1 Write in Cron: Reset Email Limits [HIGH IMPACT]

**Current code (N+1 individual saves):**
```javascript
// helper/reset-email-limit.js
const users = await Users.find({ isAdmin: false }).populate("planId");
for (const user of users) {
  user.emailPlan.currentEmailSent = 0;
  user.remainingEmailLimit = user.planId.emailLimit;
  await user.save();    // 1 write per user! (could be 5000+ users)
}
```

**Improved code (batch by plan):**
```javascript
const plans = await Plan.find({ isActive: true }).lean();
const bulkOps = plans.map(plan => ({
  updateMany: {
    filter: { planId: plan._id, isAdmin: false },
    update: {
      $set: {
        "emailPlan.currentEmailSent": 0,
        remainingEmailLimit: plan.emailLimit,
        totalEmailLimit: plan.emailLimit
      }
    }
  }
}));
await Users.bulkWrite(bulkOps);
```

**Before:** 5,000 users = 5,000 individual `save()` calls (5,000 round-trips)
**After:** 5 plans = 5 `updateMany` in 1 `bulkWrite` call (1 round-trip)

---

### IMP-3. Fix Redundant Plan.findById After populate() [HIGH IMPACT]

**Current code (redundant query):**
```javascript
// crons/cronJobs.js — lines 249-260
const updatedUsers = await Users.find({ isAdmin: false }).populate("planId");  // Already populated!
for (const user of updatedUsers) {
  if (user.planId) {
    const plan = await Plan.findById(user.planId);   // REDUNDANT! planId is already populated
    // ...
  }
}
```

**Improved code:**
```javascript
const updatedUsers = await Users.find({ isAdmin: false }).populate("planId").lean();
for (const user of updatedUsers) {
  if (user.planId) {
    // user.planId IS the plan object (already populated), use it directly
    user.remainingEmailLimit = user.planId.emailLimit;
  }
}
```

**Before:** 5,000 users = 5,000 extra `Plan.findById()` calls — completely unnecessary
**After:** 0 extra queries — plan data is already in memory from `.populate()`

---

### IMP-4. Fix Broken Promise.all Pattern [MEDIUM IMPACT]

**Current code (await inside loop defeats Promise.all):**
```javascript
// crons/cronJobs.js — lines 157-162
let promises = [];
for (let i = 0; i < expiredPlans.length; ++i) {
  let promise = await Users.updateOne(...);   // AWAIT here serializes!
  promises.push(promise);
}
const array = await Promise.all(promises);    // Promise.all does nothing — already resolved
```

**Improved code (true parallel execution):**
```javascript
const promises = expiredPlans.map(plan =>
  Users.updateOne(
    { _id: plan._id },
    { "emailPlan.renewDate": renewDate }
  )
);
await Promise.all(promises);   // Now runs all updates in parallel
```

**Before:** 100 expired plans = 100 sequential updates (~5 seconds)
**After:** 100 expired plans = 100 parallel updates (~100ms)

---

### IMP-5. Add Missing Indexes on Nested Query Fields [MEDIUM IMPACT]

**Problem:** Several queries filter on nested fields that are NOT indexed.

```javascript
// crons/cronJobs.js — queries "emailPlan.renewDate" frequently
Users.find({
  isAdmin: false,
  "emailPlan.renewDate": { $lte: IST_date }
});

// routes/userRoutes.js — queries "plan.name" frequently
Users.updateMany(
  { isAdmin: false, "plan.name": planType },
  { ... }
);
```

**Fix — Add indexes in Users schema:**
```javascript
// models/Users.js — Add these indexes
userSchema.index({ "emailPlan.renewDate": 1 });
userSchema.index({ "plan.name": 1, isAdmin: 1 });
userSchema.index({ isAdmin: 1, remainingEmailLimit: 1 });  // For supplier filtering
userSchema.index({ planExpiryDate: 1 });                    // For expiry checks
```

**Impact:** Queries on `"plan.name"` currently do a COLLSCAN on the entire Users collection. With 10,000+ users, adding this index turns it from ~50ms to ~1ms.

---

### IMP-6. Add Compound Indexes for Common Query Patterns [MEDIUM IMPACT]

**Common query combinations that need compound indexes:**

```javascript
// Supplier filter (used in RFQ distribution, hot products, listing pages)
userSchema.index({ isAdmin: 1, "plan.name": 1, remainingEmailLimit: 1, deletedAt: 1 });

// Email query (used in admin email listing)
emailSchema.index({ deletedAt: 1, emailStatus: 1, createdAt: -1 });

// Supplier product lookup
supplierSchema.index({ userId: 1, productId: 1, materialId: 1, gradeId: 1 });

// Grade lookup by product+material
gradeSchema.index({ productId: 1, materialId: 1, deletedAt: 1 });
```

**Why compound > single-field:** MongoDB can only use ONE index per query stage. If you filter by `{ isAdmin: false, "plan.name": "gold", remainingEmailLimit: { $gt: 0 } }`, a compound index covers all three conditions in a single B-tree traversal.

---

### IMP-7. Replace skip/limit with Cursor-Based Pagination [MEDIUM IMPACT]

**Current pattern (gets slower with deeper pages):**
```javascript
// Skip-based: Page 1000 skips 9,990 documents
News.find(query).sort({ date: -1 }).skip(9990).limit(10);
// MongoDB must scan through 9,990 docs to throw them away!
```

**Improved pattern (cursor-based, constant speed):**
```javascript
// First page
const results = await News.find(query)
  .sort({ date: -1 })
  .limit(10);

// Next page — use last item's date as cursor
const lastDate = results[results.length - 1].date;
const nextPage = await News.find({
  ...query,
  date: { $lt: lastDate }   // Start from where we left off
})
  .sort({ date: -1 })
  .limit(10);
```

**Before:** Page 100 = skip 990 docs (~100ms)
**After:** Page 100 = index seek to cursor position (~2ms, same as page 1)

**Where to apply:** News listing, email listing, admin user listing, RFQ listing — anywhere with high page counts.

---

### IMP-8. Use $facet for Pagination + Count in Single Query [MEDIUM IMPACT]

**Current pattern (2 separate queries):**
```javascript
// modules/admin/email/services/list.js
const [emails, total] = await Promise.all([
  Emails.find(emailQuery).limit(perPage).skip(skip).sort(sortBy),
  Emails.countDocuments(emailQuery)     // Second query with same filter
]);
```

**Improved pattern (1 query with $facet):**
```javascript
const result = await Emails.aggregate([
  { $match: emailQuery },
  {
    $facet: {
      data: [
        { $sort: sortBy },
        { $skip: skip },
        { $limit: perPage }
      ],
      totalCount: [
        { $count: "count" }
      ]
    }
  }
]);
const emails = result[0].data;
const total = result[0].totalCount[0]?.count || 0;
```

**Before:** 2 network round-trips, MongoDB scans the collection twice
**After:** 1 round-trip, collection scanned once, results split into data + count

---

### IMP-9. Add TTL Indexes for Auto-Cleanup [LOW IMPACT]

**Problem:** Several collections accumulate stale data with no automatic cleanup.

```javascript
// models/EmailLogic.js — ScheduledEmails: executed emails stay forever
// FIX: Add TTL index to auto-delete executed emails after 30 days
emailScheduleSchema.index(
  { executedAt: 1 },
  { expireAfterSeconds: 2592000 }   // 30 days
);

// models/UnregisteredUser.js — Unverified signups stay forever
// FIX: Auto-delete after 7 days
UnregisteredUserSchema.index(
  { signUpTime: 1 },
  { expireAfterSeconds: 604800 }    // 7 days
);

// models/BlockEmailAndIp.js — Temporary blocks need auto-expiry
// FIX: TTL on duration field
blockEmailSchema.index(
  { duration: 1 },
  { expireAfterSeconds: 0 }   // Expire at the date stored in 'duration' field
);
```

**Before:** Stale records accumulate → collection grows indefinitely → queries slow down
**After:** MongoDB auto-deletes expired documents → collection stays lean

---

### IMP-10. Fix Double $limit Pagination Bug [LOW IMPACT]

**Current code (silent pagination failure):**
```javascript
// modules/admin/Rfqs/controller/List.js
RfqModel.aggregate([
  { $match: { status: true } },
  { $sort: { createdAt: -1 } },
  { $limit: 100 },                    // Hard cap: only top 100
  { $skip: (page - 1) * limit },      // If page=11, limit=10: skip 100 docs
  { $limit: limit }                    // Gets 0 results! (nothing left after skip)
]);
```

**Fix:**
```javascript
RfqModel.aggregate([
  { $match: { status: true } },
  { $sort: { createdAt: -1 } },
  { $skip: (page - 1) * limit },
  { $limit: limit }
  // Remove the first $limit: 100 — let pagination handle it naturally
]);
```

---

### IMP-11. Add .limit() to Unbounded Queries [LOW IMPACT]

**Problem:** Several queries have no limit, potentially loading thousands of documents into memory.

```javascript
// modules/admin/allModule/bullmq/allModule.logic.js — PROBLEM:
let cnt = await Grades.find({}, { _id: 1, gradeId: 1 });    // ALL grades into memory
const existing = await MaterialSubProductProduct.find({ materialId }); // ALL matches

// routes/productCategoryGradesRoutes.js — PROBLEM:
let cnt = await Products.find({}, { _id: 1, productId: 1 }); // ALL products
```

**Fix:** Use `.countDocuments()` for counts, and add reasonable limits:
```javascript
// For counting, use countDocuments instead of loading all docs
const cnt = await Products.countDocuments({});

// For listings, always add a safety limit
const existing = await MaterialSubProductProduct.find({ materialId }).limit(10000);
```

---

### IMP-12. Unify Callback-Style Redis to Async/Await [LOW IMPACT]

**Current (mixed patterns):**
```javascript
// routes/userRoutes.js — Callback style
redisClient.set(phoneNo.toString(), JSON.stringify(otp), "EX", TTL, (err, ok) => {
  if (err) { /* handle */ }
});

redisClient.get(phoneNo.toString(), async (er, data) => {
  // callback inside async function — messy
});
```

**Improved (consistent async/await):**
```javascript
await redisClient.setAsync(phoneNo.toString(), JSON.stringify(otp), "EX", TTL);
const data = await redisClient.getAsync(phoneNo.toString());
```

**Note:** The `checkBlockEmailsAndIps.js` file already uses `setAsync`/`getAsync` — this pattern should be standardized across all Redis calls.

---

### IMP-13. Use Connection Pool Tuning [LOW IMPACT]

**Current:** Default pool size of 5 connections.

**Improvement for production:**
```javascript
const CONN_TO_DB = mongoose.createConnection(MONGODB_ADDRESS, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 20,         // Handle concurrent API + cron queries
  minPoolSize: 5,          // Keep minimum connections warm
  socketTimeoutMS: 45000,  // Timeout long queries
  serverSelectionTimeoutMS: 5000  // Fail fast if DB is down
});
```

**When cron jobs run:** Both the API server and cron system share the same connection pool. During heavy cron processing (email sends, plan updates), the 5 default connections may be exhausted, causing API latency spikes.

---

## PART 3: Quick Reference — Priority Matrix

| # | Optimization | Impact | Effort | Status |
|---|-------------|--------|--------|--------|
| OPT-1 | Index all foreign keys | HIGH | Done | DONE |
| OPT-2 | Compound unique index | HIGH | Done | DONE |
| OPT-3 | Multi-tier Redis caching | HIGH | Done | DONE |
| OPT-4 | Denormalization | HIGH | Done | DONE |
| OPT-5 | Field projection | MEDIUM | Done | DONE |
| OPT-6 | bulkWrite for batch upserts | HIGH | Done | DONE |
| OPT-7 | Promise.all parallel queries | MEDIUM | Done | DONE |
| OPT-8 | $match before $lookup | HIGH | Done | DONE |
| OPT-9 | Pipeline $lookup with internal filter | HIGH | Done | DONE |
| OPT-10 | BullMQ async processing | HIGH | Done | DONE |
| OPT-11 | $sample for random selection | LOW | Done | DONE |
| OPT-12 | updateMany batch updates | MEDIUM | Done | DONE |
| OPT-13 | Atlas Search for news | MEDIUM | Done | DONE |
| OPT-14 | Wildcard text index | LOW | Done | DONE |
| IMP-1 | Add .lean() everywhere | HIGH | Low | TODO |
| IMP-2 | Fix N+1 write in reset-email-limit | HIGH | Low | TODO |
| IMP-3 | Remove redundant Plan.findById | HIGH | Low | TODO |
| IMP-4 | Fix broken Promise.all pattern | MEDIUM | Low | TODO |
| IMP-5 | Add nested field indexes | MEDIUM | Low | TODO |
| IMP-6 | Add compound indexes | MEDIUM | Low | TODO |
| IMP-7 | Cursor-based pagination | MEDIUM | Medium | TODO |
| IMP-8 | $facet for pagination+count | MEDIUM | Medium | TODO |
| IMP-9 | TTL indexes for auto-cleanup | LOW | Low | TODO |
| IMP-10 | Fix double $limit bug | LOW | Low | TODO |
| IMP-11 | Add .limit() to unbounded queries | LOW | Low | TODO |
| IMP-12 | Unify Redis to async/await | LOW | Medium | TODO |
| IMP-13 | Connection pool tuning | LOW | Low | TODO |
