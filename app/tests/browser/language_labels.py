"""Exercise the generated label tables against the visible atlas in Firefox."""

from .run import APP, browser_session, open_atlas, wait_for


def main() -> None:
    output = APP / "test-results/language-labels"
    with browser_session(output, dev=True) as (browser, origin):
        open_atlas(browser, origin, preserve_default=True)

        def labels():
            return browser.js("return window.overlapTest.languageLabels()")

        def rendered(label_id, variant_prefix=""):
            def find():
                return next(
                    (
                        item
                        for item in labels()
                        if item["labelId"] == label_id
                        and item["variantId"].startswith(variant_prefix)
                        and supported(item)
                    ),
                    None,
                )

            return wait_for(find, 35, f"{variant_prefix} {label_id} label")

        def supported(label):
            return label["variantId"] in browser.js(
                "return window.overlapTest.inspect(arguments[0]).variantIds", label["coordinates"]
            )

        sino = rendered("sino1245")
        lng, lat = sino["coordinates"]
        assert 104 < lng < 113 and 32 < lat < 38
        afro = rendered("afro1255")
        lng, lat = afro["coordinates"]
        assert 13 < lng < 26 and 18 < lat < 29
        indo_european = rendered("indo1319")
        lng, lat = indo_european["coordinates"]
        assert -10 < lng < 30 and 40 < lat < 55
        browser.settled(35, fail_on_error=True)
        browser.screenshot(output / "world.png")
        browser.js(
            "document.querySelector('.map-settings__toggle').click();"
            "document.querySelector('input[name=map-projection][value=globe]').click()"
        )
        browser.settled(35, fail_on_error=True)
        rendered("afro1255")
        browser.js(
            "document.querySelector('input[name=map-projection][value=mercator]').click();"
            "document.querySelector('.map-settings__toggle').click()"
        )
        browser.js("window.overlapTest.camera([96,28], 3, 0)")
        browser.settled(35, fail_on_error=True)
        sino = rendered("sino1245")
        lng, lat = sino["coordinates"]
        assert 104 < lng < 113 and 32 < lat < 38
        browser.screenshot(output / "sino-tibetan.png")
        browser.js("window.overlapTest.camera([111.74,35.65], 5, 0)")
        rendered("sini1245")
        browser.settled(35, fail_on_error=True)
        browser.screenshot(output / "sinitic.png")
        browser.js("window.overlapTest.camera([111.74,35.65], 6, 0)")
        rendered("mand1415")
        browser.settled(35, fail_on_error=True)
        assert not any(item["labelId"] in {"sino1245", "sini1245"} for item in labels())
        browser.screenshot(output / "mandarin.png")

        browser.js(
            "window.overlapTest.configure({languageIds:['kipc1240'],center:[66,48],zoom:3})"
        )
        browser.settled(35, fail_on_error=True)
        kipchak = wait_for(
            lambda: next((label for label in labels() if label["labelId"] == "kipc1240"), None),
            35,
            "Kipchak-Turkestan label",
        )
        lng, lat = kipchak["coordinates"]
        assert 65 < lng < 73 and 44 < lat < 49
        assert any(
            id.startswith("descendants:kipc1240:")
            for id in browser.js(
                "return window.overlapTest.inspect(arguments[0]).variantIds", [lng, lat]
            )
        )
        browser.screenshot(output / "kipchak-turkestan.png")

        points = []
        for dataset in ["asher2007world", "dlac1987china"]:
            browser.js(
                "window.overlapTest.configure({languageIds:['mand1415'],"
                "center:[111.74,35.65],zoom:4,sources:[arguments[0]]})",
                dataset,
            )
            browser.settled(35, fail_on_error=True)
            label = rendered("mand1415", dataset)
            assert all(item["variantId"].startswith(dataset) for item in labels())
            points.append(label["coordinates"])
        assert abs(points[0][0] - points[1][0]) > 5

        browser.js(
            "window.overlapTest.configure({languageIds:['stan1293'],center:[-124,64],zoom:5})"
        )
        assert rendered("stan1293")["coordinates"][0] < -90
        browser.js("window.overlapTest.camera([-2,53], 5, 0)")
        island = wait_for(
            lambda: next(
                (item for item in labels() if abs(item["coordinates"][0]) < 10 and supported(item)),
                None,
            ),
            35,
            "English anchor in Great Britain",
        )
        assert island["labelId"] == "stan1293"
        browser.screenshot(output / "english.png")

        browser.js(
            "window.overlapTest.configure({languageIds:['ukra1253'],center:[31,49],zoom:6})"
        )
        ukrainian = rendered("ukra1253", "asher2007world")
        lng, lat = ukrainian["coordinates"]
        assert 31 < lng < 31.6 and 49 < lat < 49.6
        browser.screenshot(output / "ukrainian.png")

        browser.js(
            "window.overlapTest.configure({languageIds:['fiji1243'],"
            "center:[178.36,-17.86],zoom:9,sources:['wurm1981pacific']})"
        )
        assert rendered("fiji1243", "wurm1981pacific")["coordinates"][0] > 178
        browser.js("window.overlapTest.camera([-178.79,-18.21], 9, 0)")
        wait_for(
            lambda: any(item["coordinates"][0] < -178 and supported(item) for item in labels()),
            35,
            "Fijian anchor across the antimeridian",
        )

        browser.js("window.overlapTest.configure({languageIds:[],center:[-2,53],zoom:5})")
        wait_for(lambda: not labels(), 10, "empty map has no labels")
    print(
        "Family and language centering, zoom handoffs, globe, source-specific anchors, "
        "and island fallbacks passed"
    )


if __name__ == "__main__":
    main()
