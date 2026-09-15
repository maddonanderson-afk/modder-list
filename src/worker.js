const COOKIE_NAME = "people_session";
const STATE_COOKIE = "oauth_state";
const VERIFIER_COOKIE = "oauth_verifier";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/auth/google") {
        return startGoogleLogin(request, env);
      }

      if (url.pathname === "/auth/callback") {
        return finishGoogleLogin(request, env);
      }

      if (url.pathname === "/auth/logout" && request.method === "POST") {
        return logout();
      }

      if (url.pathname === "/api/people" && request.method === "GET") {
        return getPeople(env);
      }

      if (url.pathname === "/api/me" && request.method === "GET") {
        return getMe(request, env);
      }

      if (url.pathname === "/api/add" && request.method === "POST") {
        return addSelf(request, env);
      }

      if (url.pathname === "/api/remove" && request.method === "POST") {
        return removeSelf(request, env);
      }

      if (url.pathname === "/api/profile" && request.method === "POST") {
        return saveProfile(request, env);
      }

      // Let Cloudflare's static assets binding serve public/*.
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(error);
      return json({ error: "Internal server error." }, 500);
    }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function redirect(url, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      ...headers
    }
  });
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";

  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");

    if (key === name) {
      return rest.join("=");
    }
  }

  return null;
}

function randomString(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return base64url(array);
}

function base64url(input) {
  let binary = "";

  if (typeof input === "string") {
    binary = btoa(input);
  } else {
    for (const byte of input) {
      binary += String.fromCharCode(byte);
    }

    binary = btoa(binary);
  }

  return binary
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64url(value) {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded =
    normalized +
    "=".repeat((4 - normalized.length % 4) % 4);

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function sha256Base64url(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return base64url(new Uint8Array(digest));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return base64url(new Uint8Array(signature));
}

async function makeSession(user, env) {
  const payload = base64url(
    JSON.stringify({
      sub: user.sub,
      name: user.name,
      picture: user.picture || "",
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
    })
  );

  const signature = await hmac(
    payload,
    env.SESSION_SECRET
  );

  return `${payload}.${signature}`;
}

async function readSession(request, env) {
  const value = getCookie(
    request,
    COOKIE_NAME
  );

  if (!value) {
    return null;
  }

  const dot = value.lastIndexOf(".");

  if (dot <= 0) {
    return null;
  }

  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);

  const expected = await hmac(
    payload,
    env.SESSION_SECRET
  );

  if (!timingSafeEqual(signature, expected)) {
    return null;
  }

  try {
    const data = JSON.parse(
      new TextDecoder().decode(
        decodeBase64url(payload)
      )
    );

    if (
      !data.exp ||
      data.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);
  }

  return result === 0;
}


/* =========================================================
   GOOGLE LOGIN
   ========================================================= */

async function startGoogleLogin(request, env) {
  const url = new URL(request.url);

  const state = randomString(32);
  const verifier = randomString(48);
  const challenge =
    await sha256Base64url(verifier);

  const google = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth"
  );

  google.searchParams.set(
    "client_id",
    env.GOOGLE_CLIENT_ID
  );

  google.searchParams.set(
    "redirect_uri",
    `${url.origin}/auth/callback`
  );

  google.searchParams.set(
    "response_type",
    "code"
  );

  google.searchParams.set(
    "scope",
    "openid email profile"
  );

  google.searchParams.set(
    "state",
    state
  );

  google.searchParams.set(
    "code_challenge",
    challenge
  );

  google.searchParams.set(
    "code_challenge_method",
    "S256"
  );

  google.searchParams.set(
    "access_type",
    "online"
  );

  google.searchParams.set(
    "prompt",
    "select_account"
  );

  // IMPORTANT:
  // Set each cookie separately.
  const response = redirect(
    google.toString()
  );

  response.headers.append(
    "Set-Cookie",
    cookie(
      STATE_COOKIE,
      state,
      600
    )
  );

  response.headers.append(
    "Set-Cookie",
    cookie(
      VERIFIER_COOKIE,
      verifier,
      600
    )
  );

  return response;
}


async function finishGoogleLogin(request, env) {
  const url = new URL(request.url);

  const code =
    url.searchParams.get("code");

  const state =
    url.searchParams.get("state");

  const savedState =
    getCookie(
      request,
      STATE_COOKIE
    );

  const verifier =
    getCookie(
      request,
      VERIFIER_COOKIE
    );

  if (
    !code ||
    !state ||
    !savedState ||
    !verifier ||
    state !== savedState
  ) {
    const response = new Response(
      "Invalid OAuth state.",
      {
        status: 400
      }
    );

    response.headers.append(
      "Set-Cookie",
      clearCookie(STATE_COOKIE)
    );

    response.headers.append(
      "Set-Cookie",
      clearCookie(VERIFIER_COOKIE)
    );

    return response;
  }


  /* =======================================================
     EXCHANGE GOOGLE AUTHORIZATION CODE
     ======================================================= */

  const tokenResponse =
    await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/x-www-form-urlencoded"
        },

        body: new URLSearchParams({
          code,
          client_id:
            env.GOOGLE_CLIENT_ID,

          client_secret:
            env.GOOGLE_CLIENT_SECRET,

          redirect_uri:
            `${url.origin}/auth/callback`,

          grant_type:
            "authorization_code",

          code_verifier:
            verifier
        })
      }
    );


  if (!tokenResponse.ok) {
    console.error(
      await tokenResponse.text()
    );

    const response = new Response(
      "Google login failed.",
      {
        status: 502
      }
    );

    response.headers.append(
      "Set-Cookie",
      clearCookie(STATE_COOKIE)
    );

    response.headers.append(
      "Set-Cookie",
      clearCookie(VERIFIER_COOKIE)
    );

    return response;
  }


  const tokens =
    await tokenResponse.json();


  /* =======================================================
     GET GOOGLE USER INFORMATION
     ======================================================= */

  const userResponse =
    await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: {
          Authorization:
            `Bearer ${tokens.access_token}`
        }
      }
    );


  if (!userResponse.ok) {
    const response = new Response(
      "Could not retrieve Google account information.",
      {
        status: 502
      }
    );

    response.headers.append(
      "Set-Cookie",
      clearCookie(STATE_COOKIE)
    );

    response.headers.append(
      "Set-Cookie",
      clearCookie(VERIFIER_COOKIE)
    );

    return response;
  }


  const googleUser =
    await userResponse.json();


  if (
    !googleUser.sub ||
    !googleUser.name
  ) {
    const response = new Response(
      "Google did not return a usable account.",
      {
        status: 400
      }
    );

    response.headers.append(
      "Set-Cookie",
      clearCookie(STATE_COOKIE)
    );

    response.headers.append(
      "Set-Cookie",
      clearCookie(VERIFIER_COOKIE)
    );

    return response;
  }


  /* =======================================================
     CREATE SESSION
     ======================================================= */

  const session =
    await makeSession(
      {
        sub: googleUser.sub,
        name: googleUser.name,
        picture:
          googleUser.picture || ""
      },
      env
    );


  // Being logged in does NOT automatically
  // add the user to the public list.

  const response =
    redirect(`${url.origin}/`);


  response.headers.append(
    "Set-Cookie",
    cookie(
      COOKIE_NAME,
      session,
      60 * 60 * 24 * 7
    )
  );

  // Clean up OAuth cookies separately.
  response.headers.append(
    "Set-Cookie",
    clearCookie(STATE_COOKIE)
  );

  response.headers.append(
    "Set-Cookie",
    clearCookie(VERIFIER_COOKIE)
  );

  return response;
}


/* =========================================================
   PEOPLE LIST
   ========================================================= */

async function ensureProfilesTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS profiles (
      google_sub TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      picture TEXT NOT NULL DEFAULT '',
      music TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    )
  `).run();
}

async function getPeople(env) {
  await ensureProfilesTable(env);
  const result = await env.DB.prepare(`
    SELECT people.google_sub,
           COALESCE(profiles.name, people.name) AS name,
           COALESCE(profiles.picture, people.picture) AS picture,
           COALESCE(profiles.music, '') AS music
    FROM people
    LEFT JOIN profiles ON profiles.google_sub = people.google_sub
    ORDER BY people.created_at ASC
  `).all();

  return json({ people: result.results || [] });
}


/* =========================================================
   CURRENT USER
   ========================================================= */

async function getMe(request, env) {
  await ensureProfilesTable(env);
  const session = await readSession(request, env);

  if (!session) {
    return json({ user: null });
  }

  const row = await env.DB.prepare(`
    SELECT people.name AS old_name, people.picture AS old_picture,
           profiles.name, profiles.picture, profiles.music
    FROM people
    LEFT JOIN profiles ON profiles.google_sub = people.google_sub
    WHERE people.google_sub = ?
    LIMIT 1
  `).bind(session.sub).first();

  return json({
    user: {
      name: row?.name || row?.old_name || session.name,
      picture: row?.picture || row?.old_picture || session.picture || '',
      music: row?.music || '',
      added: !!row
    }
  });
}


/* =========================================================
   ADD YOURSELF
   ========================================================= */

async function addSelf(request, env) {
  const session = await readSession(request, env);

  if (!session) {
    return json({ error: 'You must sign in with Google first.' }, 401);
  }

  let body = {};
  try { body = await request.json(); } catch {}

  const name = String(body.name || session.name).trim();
  if (!name || name.length > 32) {
    return json({ error: 'Display name must be 1–32 characters.' }, 400);
  }

  await ensureProfilesTable(env);

  await env.DB.prepare(`
    INSERT INTO people (google_sub, name, picture, created_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(google_sub) DO UPDATE SET
      name = excluded.name, picture = excluded.picture
  `).bind(session.sub, name, session.picture || '').run();

  await env.DB.prepare(`
    INSERT INTO profiles (google_sub, name, picture, music, updated_at)
    VALUES (?, ?, ?, '', unixepoch())
    ON CONFLICT(google_sub) DO UPDATE SET
      name = excluded.name,
      updated_at = unixepoch()
  `).bind(session.sub, name, session.picture || '').run();

  return json({ ok: true, name });
}

async function saveProfile(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ error: 'You must sign in with Google first.' }, 401);

  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'Invalid profile data.' }, 400);
  }

  const name = String(body.name || '').trim();
  const picture = String(body.picture || '').trim();
  const music = String(body.music || '').trim();

  if (!name || name.length > 32) return json({ error: 'Display name must be 1–32 characters.' }, 400);
  if (picture.length > 500) return json({ error: 'Profile picture URL is too long.' }, 400);
  if (music.length > 500) return json({ error: 'Music URL is too long.' }, 400);

  for (const value of [picture, music]) {
    if (value) {
      try {
        const u = new URL(value);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      } catch {
        return json({ error: 'Profile picture and music must be valid http(s) URLs.' }, 400);
      }
    }
  }

  await ensureProfilesTable(env);

  await env.DB.prepare(`
    INSERT INTO profiles (google_sub, name, picture, music, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(google_sub) DO UPDATE SET
      name = excluded.name,
      picture = excluded.picture,
      music = excluded.music,
      updated_at = unixepoch()
  `).bind(session.sub, name, picture, music).run();

  if (await env.DB.prepare('SELECT 1 FROM people WHERE google_sub = ? LIMIT 1').bind(session.sub).first()) {
    await env.DB.prepare('UPDATE people SET name = ?, picture = ? WHERE google_sub = ?').bind(name, picture, session.sub).run();
  }

  return json({ ok: true });
}


/* =========================================================
   REMOVE YOURSELF
   ========================================================= */

async function removeSelf(request, env) {
  const session =
    await readSession(
      request,
      env
    );

  if (!session) {
    return json(
      {
        error:
          "You must sign in with Google first."
      },
      401
    );
  }

  await env.DB.prepare(
    `DELETE FROM people
     WHERE google_sub = ?`
  )
    .bind(session.sub)
    .run();

  return json({
    ok: true
  });
}


/* =========================================================
   LOGOUT
   ========================================================= */

function logout() {
  const response =
    new Response(
      JSON.stringify({
        ok: true
      }),
      {
        status: 200,
        headers: {
          "content-type":
            "application/json; charset=utf-8",

          "cache-control":
            "no-store"
        }
      }
    );

  response.headers.append(
    "Set-Cookie",
    clearCookie(COOKIE_NAME)
  );

  return response;
}
