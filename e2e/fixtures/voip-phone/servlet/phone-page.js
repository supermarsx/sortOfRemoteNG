// Synthetic stand-in for the script bundle a Yealink T2x servlet login page
// loads (`commonjs.js` on real firmware). Hand-written for this repository from
// the publicly attested login contract in `.orchestration/plans/t96.md` §2.1.
// No vendor code or markup is copied and no firmware was downloaded or
// decrypted; only the observable contract is reproduced.
//
// Two behaviours matter, and both are deliberate:
//
//   1. `window.onload` reads `parent.document` BEFORE it binds anything, the
//      way the vendor bundle does. In a normal top-level browser `parent` is
//      the window itself and the read succeeds; inside the app's cross-origin
//      website frame it throws SecurityError and the rest of `onload` never
//      runs, so `#idConfirm` never gets its handler (t95, measured).
//   2. The login body is computed in the page, so filling the two inputs and
//      clicking cannot finish this login on its own:
//        pwd    = base64(AES-128-CBC-ZeroPad("<rand>;<JSESSIONID>;<password>"))
//        rsakey = base64(RSA-PKCS1v1.5(<aes key as 32 hex chars>))
//        rsaiv  = base64(RSA-PKCS1v1.5(<aes iv as 32 hex chars>))
//      with the AES key and IV each MD5 of a fresh random token, and the RSA
//      public key taken from the page's own `g_rsa_n` / `g_rsa_e`.
//
// The module also runs under `node:vm` with a document stub, so the same body
// builder is exercised by `voip-phone-fixture.test.ts` without a browser.
(function (global) {
  "use strict";

  var LOGIN_POST_PATH = "/servlet?m=mod_listener&p=login&q=login";
  var STATUS_PATH = "/servlet?m=mod_data&p=status&q=load";

  var state = {
    onloadStarted: false,
    onloadFinished: false,
    onloadError: null,
    boundConfirm: false,
    doLoginCalls: 0,
    posts: 0,
    authstatus: null,
    lastError: null,
    sessionSource: "none",
    cookieVisible: false,
    alerts: [],
  };

  // ── small helpers ────────────────────────────────────────────────────────

  function utf8Bytes(text) {
    return new TextEncoder().encode(String(text));
  }

  function hexBytes(hex) {
    var out = new Uint8Array(hex.length >> 1);
    for (var i = 0; i < out.length; i++)
      out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function bytesHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++)
      out += (bytes[i] + 256).toString(16).slice(1);
    return out;
  }

  function base64(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i]);
    return global.btoa(binary);
  }

  function randomToken(byteLength) {
    var bytes = new Uint8Array(byteLength);
    global.crypto.getRandomValues(bytes);
    return bytesHex(bytes);
  }

  // ── MD5 (RFC 1321), used only to derive the AES key and IV ───────────────

  var MD5_SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
    9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21,
  ];
  var MD5_SINES = (function () {
    var table = [];
    for (var i = 0; i < 64; i++)
      table.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
    return table;
  })();

  function md5Hex(input) {
    var bytes = utf8Bytes(input);
    var blocks = ((bytes.length + 8) >>> 6) + 1;
    var padded = new Uint8Array(blocks * 64);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    var view = new DataView(padded.buffer);
    var bits = bytes.length * 8;
    view.setUint32(padded.length - 8, bits >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(bits / 4294967296), true);
    var a0 = 0x67452301,
      b0 = 0xefcdab89,
      c0 = 0x98badcfe,
      d0 = 0x10325476;
    for (var offset = 0; offset < padded.length; offset += 64) {
      var words = [];
      for (var w = 0; w < 16; w++)
        words.push(view.getUint32(offset + w * 4, true));
      var a = a0,
        b = b0,
        c = c0,
        d = d0;
      for (var i = 0; i < 64; i++) {
        var mixed, index;
        if (i < 16) {
          mixed = (b & c) | (~b & d);
          index = i;
        } else if (i < 32) {
          mixed = (d & b) | (~d & c);
          index = (5 * i + 1) % 16;
        } else if (i < 48) {
          mixed = b ^ c ^ d;
          index = (3 * i + 5) % 16;
        } else {
          mixed = c ^ (b | ~d);
          index = (7 * i) % 16;
        }
        mixed = (mixed + a + MD5_SINES[i] + words[index]) | 0;
        a = d;
        d = c;
        c = b;
        b =
          (b + ((mixed << MD5_SHIFTS[i]) | (mixed >>> (32 - MD5_SHIFTS[i])))) |
          0;
      }
      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }
    var digest = new Uint8Array(16);
    [a0, b0, c0, d0].forEach(function (word, part) {
      for (var byte = 0; byte < 4; byte++)
        digest[part * 4 + byte] = (word >>> (byte * 8)) & 255;
    });
    return bytesHex(digest);
  }

  // ── RSA PKCS#1 v1.5 public encryption over the page's g_rsa_n / g_rsa_e ──

  function modPow(base, exponent, modulus) {
    var result = BigInt(1);
    var factor = base % modulus;
    var rest = exponent;
    while (rest > BigInt(0)) {
      if (rest & BigInt(1)) result = (result * factor) % modulus;
      factor = (factor * factor) % modulus;
      rest >>= BigInt(1);
    }
    return result;
  }

  function rsaEncryptPkcs1(modulusHex, exponentHex, text) {
    var modulus = BigInt("0x" + modulusHex);
    var exponent = BigInt("0x" + exponentHex);
    var size = modulusHex.length >> 1;
    var message = utf8Bytes(text);
    if (message.length > size - 11) throw new Error("rsa: block too long");
    var block = new Uint8Array(size);
    var padding = size - message.length - 3;
    var noise = new Uint8Array(padding);
    global.crypto.getRandomValues(noise);
    block[0] = 0;
    block[1] = 2;
    for (var i = 0; i < padding; i++) block[2 + i] = noise[i] || 1;
    block[2 + padding] = 0;
    block.set(message, 3 + padding);
    var cipher = modPow(BigInt("0x" + bytesHex(block)), exponent, modulus)
      .toString(16)
      .padStart(size * 2, "0");
    return base64(hexBytes(cipher));
  }

  // ── AES-128-CBC with zero padding ────────────────────────────────────────

  function aesCbcZeroPad(keyHex, ivHex, plaintext) {
    var message = utf8Bytes(plaintext);
    var padded = new Uint8Array(Math.ceil(message.length / 16) * 16 || 16);
    padded.set(message);
    return global.crypto.subtle
      .importKey("raw", hexBytes(keyHex), { name: "AES-CBC" }, false, [
        "encrypt",
      ])
      .then(function (key) {
        return global.crypto.subtle.encrypt(
          { name: "AES-CBC", iv: hexBytes(ivHex) },
          key,
          padded,
        );
      })
      .then(function (buffer) {
        // WebCrypto always appends a PKCS#7 block. The input is block aligned,
        // so that trailing block is pure padding: dropping it leaves exactly
        // the zero-padded CBC ciphertext the phone's own bundle produces.
        var cipher = new Uint8Array(buffer);
        return base64(cipher.subarray(0, cipher.length - 16));
      });
  }

  // ── the login body ───────────────────────────────────────────────────────

  /**
   * @param {{username: string, password: string, jsessionid: string,
   *          rsaModulusHex: string, rsaExponentHex: string}} options
   * @returns {Promise<{username: string, pwd: string, rsakey: string,
   *          rsaiv: string}>}
   */
  function buildLoginBody(options) {
    var keyHex = md5Hex(randomToken(16));
    var ivHex = md5Hex(randomToken(16));
    var plaintext =
      randomToken(8) + ";" + options.jsessionid + ";" + options.password;
    return aesCbcZeroPad(keyHex, ivHex, plaintext).then(function (pwd) {
      return {
        username: options.username,
        pwd: pwd,
        rsakey: rsaEncryptPkcs1(
          options.rsaModulusHex,
          options.rsaExponentHex,
          keyHex,
        ),
        rsaiv: rsaEncryptPkcs1(
          options.rsaModulusHex,
          options.rsaExponentHex,
          ivHex,
        ),
      };
    });
  }

  // ── page wiring ──────────────────────────────────────────────────────────

  function readSessionId() {
    var fromCookie = /(?:^|;\s*)JSESSIONID=([^;]+)/.exec(
      global.document.cookie || "",
    );
    state.cookieVisible = !!fromCookie;
    if (fromCookie) {
      state.sessionSource = "cookie";
      return fromCookie[1];
    }
    // The website frame is cross-site to the app document, so the engine may
    // refuse to store the phone's cookie. The fixture also renders the id into
    // the page so the rest of the contract stays measurable either way.
    if (global.g_jsessionid) {
      state.sessionSource = "page-var";
      return global.g_jsessionid;
    }
    state.sessionSource = "none";
    return "";
  }

  function setValue(id, value) {
    var field = global.document.getElementById(id);
    if (field) field.value = value;
  }

  function showResult(text) {
    var box = global.document.getElementById("_RES_INFO_");
    if (box) box.textContent = text;
  }

  function doLogin() {
    state.doLoginCalls++;
    var username = global.document.getElementById("idUsername");
    var password = global.document.getElementById("idPassword");
    return buildLoginBody({
      username: username ? username.value : "",
      password: password ? password.value : "",
      jsessionid: readSessionId(),
      rsaModulusHex: String(global.g_rsa_n || ""),
      rsaExponentHex: String(global.g_rsa_e || "010001"),
    })
      .then(function (fields) {
        setValue("idRsakey", fields.rsakey);
        setValue("idRsaiv", fields.rsaiv);
        return new Promise(function (resolve) {
          var request = new XMLHttpRequest();
          request.open(
            "POST",
            LOGIN_POST_PATH + "&Rajax=" + Math.random(),
            true,
          );
          request.setRequestHeader(
            "Content-Type",
            "application/x-www-form-urlencoded",
          );
          request.onreadystatechange = function () {
            if (request.readyState === 4) resolve(request.responseText || "");
          };
          state.posts++;
          request.send(
            "username=" +
              encodeURIComponent(fields.username) +
              "&pwd=" +
              encodeURIComponent(fields.pwd) +
              "&rsakey=" +
              encodeURIComponent(fields.rsakey) +
              "&rsaiv=" +
              encodeURIComponent(fields.rsaiv),
          );
        });
      })
      .then(function (body) {
        var answer = /"authstatus"\s*:\s*"([a-z]+)"/.exec(body);
        state.authstatus = answer ? answer[1] : null;
        if (state.authstatus === "done") {
          showResult("Signed in.");
          return;
        }
        if (state.authstatus === "none") {
          global.alert("Wrong user name or password!");
          state.alerts.push("none");
        } else if (state.authstatus === "lock") {
          global.alert("The account is locked. Try again later.");
          state.alerts.push("lock");
        } else {
          global.alert("Login failed.");
          state.alerts.push("unclassified");
        }
        showResult("Login failed.");
      })
      .catch(function (error) {
        state.lastError = String((error && error.message) || error);
      });
  }

  function install() {
    state.onloadStarted = true;
    // The vendor bundle reads the embedding document here. Inside the app's
    // website frame this is the SecurityError that aborts the rest of onload.
    var embedding = global.parent.document;
    state.parentTitle = embedding ? embedding.title : null;
    var confirm = global.document.getElementById("idConfirm");
    if (confirm) {
      confirm.onclick = function (event) {
        if (event && event.preventDefault) event.preventDefault();
        doLogin();
        return false;
      };
      state.boundConfirm = true;
    }
    var password = global.document.getElementById("idPassword");
    if (password)
      password.onkeydown = function (event) {
        if (event && event.keyCode === 13) doLogin();
      };
    state.onloadFinished = true;
  }

  global.__yealinkPage = {
    md5Hex: md5Hex,
    rsaEncryptPkcs1: rsaEncryptPkcs1,
    buildLoginBody: buildLoginBody,
    doLogin: doLogin,
    state: state,
    paths: { login: LOGIN_POST_PATH, status: STATUS_PATH },
  };

  if (global.document && typeof global.addEventListener === "function")
    global.onload = function () {
      try {
        install();
      } catch (error) {
        state.onloadError = String((error && error.name) || error);
        throw error;
      }
    };
})(typeof window !== "undefined" ? window : globalThis);
