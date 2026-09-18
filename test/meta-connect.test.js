import test from "node:test";
import assert from "node:assert/strict";
import { callTool, listAllAds, getAdCreativeAssets, setAdStatus, updateAdSetBudget, errorToApiShape } from "../src/lib/meta-connect.js";

// Gitleaks'in gerçek bir secret sanmaması için açıkça sahte bir değer kullanılıyor.
process.env.META_CONNECT_URL = process.env.META_CONNECT_URL || "https://buzsu-social-connect.example.test";
process.env.META_CONNECT_MCP_PATH_SECRET = process.env.META_CONNECT_MCP_PATH_SECRET || "test-secret-placeholder";

const SESSION_ID = "sess-abc123";

function fakeResponse({ ok = true, status = 200, statusText = "OK", headers = {}, bodyText = "" } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok,
    status,
    statusText,
    headers: { get: (name) => lower[String(name).toLowerCase()] },
    text: async () => bodyText
  };
}

function initSuccessResponse(sessionId = SESSION_ID) {
  return fakeResponse({
    headers: { "content-type": "application/json", "mcp-session-id": sessionId },
    bodyText: JSON.stringify({
      jsonrpc: "2.0",
      id: "init",
      result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "buzsu-social-connect", version: "0.7.0" } }
    })
  });
}

function notifiedResponse() {
  return fakeResponse({ status: 202, bodyText: "" });
}

function toolCallSuccessResponse(payload) {
  return fakeResponse({
    headers: { "content-type": "application/json" },
    bodyText: JSON.stringify({ jsonrpc: "2.0", id: "call", result: { content: [{ type: "text", text: JSON.stringify(payload) }] } })
  });
}

function deleteSuccessResponse() {
  return fakeResponse({ status: 200 });
}

function withMockedFetch(dispatch, run) {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => dispatch(String(url), options);
  return run().finally(() => {
    global.fetch = originalFetch;
  });
}

// Çoğu testte initialize/notifications/initialized aynı, yalnız tools/call ve
// DELETE davranışı değişir — bu yardımcı tekrarı azaltır.
function withStandardHandshake(onToolCall, onDelete = () => deleteSuccessResponse()) {
  return (url, options) => {
    if (options.method === "DELETE") return onDelete(url, options);
    const message = JSON.parse(options.body);
    if (message.method === "initialize") return initSuccessResponse();
    if (message.method === "notifications/initialized") return notifiedResponse();
    if (message.method === "tools/call") return onToolCall(message, options);
    throw new Error(`beklenmeyen JSON-RPC method: ${message.method}`);
  };
}

test("initialize başarılı olur, session id header'dan alınır, tools/call doğru payload ile gider ve content[0].text JSON parse edilerek döner", async () => {
  const deleteCalls = [];
  await withMockedFetch(
    withStandardHandshake(
      (message, options) => {
        assert.equal(message.params.name, "ads_list_ads");
        // JSON.stringify undefined alanları düşürür — istek gövdesinde yalnız tanımlı alanlar kalır.
        assert.deepEqual(message.params.arguments, { limit: 100 });
        assert.equal(options.headers["mcp-session-id"], SESSION_ID);
        return toolCallSuccessResponse({ data: [{ id: "ad_1" }], paging: {} });
      },
      (url, options) => {
        deleteCalls.push(options.headers["mcp-session-id"]);
        return deleteSuccessResponse();
      }
    ),
    async () => {
      const result = await callTool("ads_list_ads", { ad_account_id: undefined, limit: 100, after: undefined });
      assert.deepEqual(result, { data: [{ id: "ad_1" }], paging: {} });
    }
  );
  assert.deepEqual(deleteCalls, [SESSION_ID]);
});

test("result.isError === true olduğunda hata fırlatılır ve DELETE yine gönderilir", async () => {
  let deleteCalled = false;
  await withMockedFetch(
    withStandardHandshake(
      () =>
        fakeResponse({
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({ jsonrpc: "2.0", id: "call", result: { isError: true, content: [{ type: "text", text: "Ad not found" }] } })
        }),
      () => {
        deleteCalled = true;
        return deleteSuccessResponse();
      }
    ),
    async () => {
      await assert.rejects(() => callTool("ads_get_ad_creative_assets", { ad_id: "999" }), /Ad not found/);
    }
  );
  assert.equal(deleteCalled, true);
});

test("tools/call cevabındaki üst seviye JSON-RPC error hata olarak fırlatılır", async () => {
  await withMockedFetch(
    withStandardHandshake(() =>
      fakeResponse({
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({ jsonrpc: "2.0", id: "call", error: { code: -32601, message: "Method not found" } })
      })
    ),
    async () => {
      await assert.rejects(() => callTool("no_such_tool", {}), /Method not found/);
    }
  );
});

test("content[0].text geçersiz JSON içeriyorsa hata fırlatılır", async () => {
  await withMockedFetch(
    withStandardHandshake(() =>
      fakeResponse({
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({ jsonrpc: "2.0", id: "call", result: { content: [{ type: "text", text: "{not valid json" }] } })
      })
    ),
    async () => {
      await assert.rejects(() => callTool("ads_list_ads", {}), /sonucundaki JSON parse edilemedi/);
    }
  );
});

test("tools/call HTTP non-2xx cevap verirse hata fırlatılır ve DELETE session id ile denenir", async () => {
  let deleteSessionHeader;
  await withMockedFetch(
    withStandardHandshake(
      () => fakeResponse({ ok: false, status: 502, statusText: "Bad Gateway", bodyText: "upstream down" }),
      (url, options) => {
        deleteSessionHeader = options.headers["mcp-session-id"];
        return deleteSuccessResponse();
      }
    ),
    async () => {
      await assert.rejects(() => callTool("ads_list_ads", {}), /MCP HTTP 502/);
    }
  );
  assert.equal(deleteSessionHeader, SESSION_ID);
});

test("initialize hiç session id döndürmezse (ağ hatası) DELETE hiç denenmez", async () => {
  let deleteCalled = false;
  await withMockedFetch(
    (url, options) => {
      if (options.method === "DELETE") {
        deleteCalled = true;
        return deleteSuccessResponse();
      }
      throw new Error("network down");
    },
    async () => {
      await assert.rejects(() => callTool("ads_list_ads", {}), /Meta bağlantı servisine ulaşılamadı/);
    }
  );
  assert.equal(deleteCalled, false);
});

test("initialize HTTP response mcp-session-id header'ı taşıyor ama gövde parse hatası veriyorsa, cleanup yine de bu session id ile DELETE dener", async () => {
  let deleteSessionHeader;
  await withMockedFetch(
    (url, options) => {
      if (options.method === "DELETE") {
        deleteSessionHeader = options.headers["mcp-session-id"];
        return deleteSuccessResponse();
      }
      const message = JSON.parse(options.body);
      if (message.method === "initialize") {
        // Header geçerli, ama body bozuk — server session'ı zaten oluşturmuş olabilir.
        return fakeResponse({ headers: { "content-type": "application/json", "mcp-session-id": SESSION_ID }, bodyText: "{not valid json" });
      }
      return notifiedResponse();
    },
    async () => {
      await assert.rejects(() => callTool("ads_list_ads", {}), /MCP servisinden gelen yanıt parse edilemedi/);
    }
  );
  assert.equal(deleteSessionHeader, SESSION_ID);
});

test("tools/call hata verir ve DELETE de hata verirse, dışarı çıkan hata orijinal tools/call hatası olarak kalır", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await withMockedFetch(
      withStandardHandshake(
        () => fakeResponse({ ok: false, status: 502, statusText: "Bad Gateway", bodyText: "upstream down" }),
        () => {
          throw new Error("cleanup network hatası");
        }
      ),
      async () => {
        await assert.rejects(() => callTool("ads_list_ads", {}), /MCP HTTP 502/);
      }
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("tools/call başarılı olur ama DELETE cleanup hata verirse, başarılı sonuç bozulmadan döner ve cleanup hatası redakte biçimde loglanır", async () => {
  const loggedLines = [];
  const originalConsoleError = console.error;
  console.error = (...args) => loggedLines.push(args.join(" "));
  try {
    await withMockedFetch(
      withStandardHandshake(
        () => toolCallSuccessResponse({ ok: true, ads: [] }),
        () => {
          throw new Error(`cleanup failed for secret ${process.env.META_CONNECT_MCP_PATH_SECRET}`);
        }
      ),
      async () => {
        const result = await callTool("ads_list_ads", {});
        assert.deepEqual(result, { ok: true, ads: [] });
      }
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.ok(loggedLines.some((line) => line.includes("session cleanup")), "cleanup hatası loglanmadı");
  assert.ok(!loggedLines.some((line) => line.includes(process.env.META_CONNECT_MCP_PATH_SECRET)), "cleanup logu secret'ı ham içeriyor");
});

test("MCP çağrısı zaman aşımına uğrarsa AbortController devreye girer ve MCP_TIMEOUT koduyla hata fırlatılır", async () => {
  await withMockedFetch(
    (url, options) => {
      if (options.method === "DELETE") return deleteSuccessResponse();
      const message = JSON.parse(options.body);
      if (message.method === "initialize") {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      return notifiedResponse();
    },
    async () => {
      await assert.rejects(() => callTool("ads_list_ads", {}, { timeoutMs: 20 }), (error) => {
        assert.equal(error.code, "MCP_TIMEOUT");
        return true;
      });
    }
  );
});

test("listAllAds birden fazla sayfayı paging.cursors.after zinciriyle doğru birleştirir", async () => {
  let page = 0;
  await withMockedFetch(
    withStandardHandshake((message) => {
      page += 1;
      if (page === 1) {
        assert.equal(message.params.arguments.after, undefined);
        return toolCallSuccessResponse({ data: [{ id: "ad_1" }], paging: { cursors: { after: "CURSOR_A" } } });
      }
      assert.equal(message.params.arguments.after, "CURSOR_A");
      return toolCallSuccessResponse({ data: [{ id: "ad_2" }], paging: {} });
    }),
    async () => {
      const ads = await listAllAds();
      assert.deepEqual(ads.map((ad) => ad.id), ["ad_1", "ad_2"]);
    }
  );
  assert.equal(page, 2);
});

test("listAllAds cursor yoksa tek sayfada tamamlanır", async () => {
  let toolCalls = 0;
  await withMockedFetch(
    withStandardHandshake(() => {
      toolCalls += 1;
      return toolCallSuccessResponse({ data: [{ id: "only_ad" }], paging: {} });
    }),
    async () => {
      const ads = await listAllAds();
      assert.deepEqual(ads.map((ad) => ad.id), ["only_ad"]);
    }
  );
  assert.equal(toolCalls, 1);
});

test("listAllAds aynı cursor tekrar gelirse sonsuz döngüye girmez", async () => {
  let toolCalls = 0;
  await withMockedFetch(
    withStandardHandshake(() => {
      toolCalls += 1;
      return toolCallSuccessResponse({ data: [{ id: `ad_${toolCalls}` }], paging: { cursors: { after: "SAME_CURSOR" } } });
    }),
    async () => {
      const ads = await listAllAds();
      assert.equal(ads.length, 2); // ilk sayfa + cursor'ın tekrarlandığı ikinci sayfa; üçüncüye geçilmez
    }
  );
  assert.equal(toolCalls, 2);
});

test("listAllAds sürekli yeni cursor gelse bile MAX_AD_PAGES sınırında durur", async () => {
  let toolCalls = 0;
  await withMockedFetch(
    withStandardHandshake(() => {
      toolCalls += 1;
      return toolCallSuccessResponse({ data: [{ id: `ad_${toolCalls}` }], paging: { cursors: { after: `CURSOR_${toolCalls}` } } });
    }),
    async () => {
      const ads = await listAllAds();
      assert.equal(ads.length, 20);
    }
  );
  assert.equal(toolCalls, 20);
});

test("hata mesajlarında META_CONNECT_MCP_PATH_SECRET hiçbir zaman ham görünmez", async () => {
  await withMockedFetch(
    (url) => {
      throw new Error(`connection to ${url} failed`); // url secret'ı path'inde taşır
    },
    async () => {
      await assert.rejects(() => callTool("ads_list_ads", {}), (error) => {
        assert.ok(!error.message.includes(process.env.META_CONNECT_MCP_PATH_SECRET), `hata mesajı secret'ı ham içeriyor: ${error.message}`);
        assert.match(error.message, /\*\*\*/);
        return true;
      });
    }
  );
});

test("getAdCreativeAssets, ads_get_ad_creative_assets çıktısını bilinen alanlara normalize eder", async () => {
  await withMockedFetch(
    withStandardHandshake(() =>
      toolCallSuccessResponse({
        ad_id: "ad_1",
        ad_name: "Code Web Trafiği",
        adset_id: "adset_1",
        campaign_id: "camp_1",
        creative_id: "creative_1",
        format: "carousel",
        supported: true,
        reason: null,
        has_asset_feed_spec: false,
        primary_text: "Ana metin",
        headline: "Başlık",
        cards: [
          { position: 1, image_hash: "hash_a", image_url: "https://example.test/a.jpg", permalink_url: null },
          { position: 2, image_hash: "hash_a", image_url: "https://example.test/a.jpg", permalink_url: null }
        ],
        diagnostics: { duplicate_image_hashes: ["hash_a"] },
        image_lookup_error: null
      })
    ),
    async () => {
      const creative = await getAdCreativeAssets("ad_1");
      assert.equal(creative.ad_id, "ad_1");
      assert.equal(creative.format, "carousel");
      assert.equal(creative.cards.length, 2);
      assert.deepEqual(creative.duplicate_image_hashes, ["hash_a"]);
      assert.equal(creative.image_lookup_error, null);
    }
  );
});

test("errorToApiShape MCP_TIMEOUT kodunu korur, diğer hatalar için MCP_UPSTREAM_ERROR döner ve mesajı redakte eder", () => {
  const secret = process.env.META_CONNECT_MCP_PATH_SECRET;
  const timeoutError = Object.assign(new Error(`zaman aşımı ${secret}`), { code: "MCP_TIMEOUT" });
  const genericError = new Error(`hata ${secret}`);

  const timeoutShape = errorToApiShape(timeoutError);
  const genericShape = errorToApiShape(genericError);

  assert.equal(timeoutShape.code, "MCP_TIMEOUT");
  assert.ok(!timeoutShape.message.includes(secret));
  assert.equal(genericShape.code, "MCP_UPSTREAM_ERROR");
  assert.ok(!genericShape.message.includes(secret));
});

test("setAdStatus, ads_set_ad_status'u doğru argümanlarla çağırır ve confirmed:true'yu sunucu tarafında sabit gönderir", async () => {
  let capturedArgs;
  await withMockedFetch(
    withStandardHandshake((message) => {
      capturedArgs = message.params.arguments;
      return toolCallSuccessResponse({ success: true });
    }),
    async () => {
      const result = await setAdStatus("ad_1", "PAUSED");
      assert.deepEqual(result, { success: true });
    }
  );
  assert.deepEqual(capturedArgs, { ad_id: "ad_1", status: "PAUSED", confirmed: true });
});

test("updateAdSetBudget, ads_update_adset_budget'ı doğru argümanlarla çağırır ve confirmed:true'yu sunucu tarafında sabit gönderir", async () => {
  let capturedArgs;
  let capturedName;
  await withMockedFetch(
    withStandardHandshake((message) => {
      capturedName = message.params.name;
      capturedArgs = message.params.arguments;
      return toolCallSuccessResponse({ success: true });
    }),
    async () => {
      const result = await updateAdSetBudget("adset_1", 250);
      assert.deepEqual(result, { success: true });
    }
  );
  assert.equal(capturedName, "ads_update_adset_budget");
  assert.deepEqual(capturedArgs, { adset_id: "adset_1", daily_budget_try: 250, confirmed: true });
});

test("setAdStatus, MCP guard'ı hata döndürürse (örn. connector tarafında bir kısıt) hatayı olduğu gibi fırlatır", async () => {
  await withMockedFetch(
    withStandardHandshake(() =>
      fakeResponse({
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({ jsonrpc: "2.0", id: "call", result: { isError: true, content: [{ type: "text", text: "Bilinmeyen ad_id" }] } })
      })
    ),
    async () => {
      await assert.rejects(() => setAdStatus("ad_bad", "ACTIVE"), /Bilinmeyen ad_id/);
    }
  );
});
