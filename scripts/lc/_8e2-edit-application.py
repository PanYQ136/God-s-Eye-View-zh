import io, sys

path = r"D:\Hermes\gods-eye-view\src\standalone\application.js"
with io.open(path, "r", encoding="utf-8", newline="") as f:
    src = f.read()

nl = "\r\n" if "\r\n" in src else "\n"

# 1. import the hydration scheduler next to the createApplication import.
old = "import { createApplication } from '../app/application.js';" + nl
assert src.count(old) == 1, src.count(old)
src = src.replace(
    old,
    old
    + "import { scheduleCatalogHydration } from '../app/deferredCatalog.js';"
    + nl,
    1,
)

# 2. keep a handle on the composed application so start() can schedule hydration.
old = "  let catalog;" + nl + "  return createApplication({" 
assert src.count(old) == 1, src.count(old)
src = src.replace(
    old, "  let catalog;" + nl + "  const application = createApplication({", 1
)

# 3. Schedule the deferred layer hydration once startup has settled.
old = (
    "    createTools: (context) =>"
    + nl
    + "      createStandaloneTools({ ...context, loadingScreen, placeSearch, voice }),"
    + nl
    + "  });"
    + nl
    + "}"
)
assert src.count(old) == 1, src.count(old)
new = (
    "    createTools: (context) =>"
    + nl
    + "      createStandaloneTools({ ...context, loadingScreen, placeSearch, voice }),"
    + nl
    + "  });"
    + nl
    + "  return Object.freeze({"
    + nl
    + "    ...application,"
    + nl
    + "    /**"
    + nl
    + "     * Phase8E2：应用就绪之后才水合波次 2 图层（首帧 + 空闲），"
    + nl
    + "     * 让首屏完全不请求非默认 layers 的工厂 chunk。"
    + nl
    + "     */"
    + nl
    + "    start() {"
    + nl
    + "      return application.start().then((components) => {"
    + nl
    + "        void scheduleCatalogHydration(catalog);"
    + nl
    + "        return components;"
    + nl
    + "      });"
    + nl
    + "    },"
    + nl
    + "  });"
    + nl
    + "}"
)
src = src.replace(old, new, 1)

with io.open(path, "w", encoding="utf-8", newline="") as f:
    f.write(src)
print("ok", len(src))
