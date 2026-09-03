package de.stegmann.brickmerge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class InputResolverTest {
    @Test public void readsSetFromBrickmergeUrl() {
        assertEquals("31214", InputResolver.candidateFromUrl(
                "https://www.brickmerge.de/31214-1_lego-art-love"));
    }

    @Test public void readsSetAndEanFromProductUrls() {
        assertEquals("42154", InputResolver.candidateFromUrl(
                "https://shop.example/lego-technic-set-42154"));
        assertEquals("5702017424965", InputResolver.candidateFromUrl(
                "https://shop.example/product?ean=5702017424965"));
    }

    @Test public void ignoresAmazonAsinDigits() {
        assertNull(InputResolver.candidateFromUrl(
                "https://www.amazon.es/dp/B01J41MPF8?tag=example-21"));
    }

    @Test public void readsSetFromDownloadedProductHtml() {
        String html = "<html><head><title>LEGO Architecture London 21034 – Amazon</title></head></html>";
        assertEquals("21034", InputResolver.candidateFromHtml(html));
    }

    @Test public void prefersSetOverYearInTitle() {
        String html = "<title>LEGO Neuheiten 2026: Set 75418 Adventskalender</title>";
        assertEquals("75418", InputResolver.candidateFromHtml(html));
    }

    @Test public void doesNotTreatYearAsSetNumber() {
        assertNull(InputResolver.candidateFromHtml("<title>LEGO Neuheiten 2026</title>"));
    }

    @Test public void detectsOnlyHttpUrls() {
        assertTrue(InputResolver.isHttpUrl("https://example.com/product"));
        assertFalse(InputResolver.isHttpUrl("brickmerge://search?q=42154"));
        assertFalse(InputResolver.isHttpUrl("LEGO 42154"));
    }

    @Test public void extractsUrlFromSharedText() {
        assertEquals("https://shop.example/lego-42154",
                InputResolver.extractHttpUrl("LEGO Angebot: https://shop.example/lego-42154)."));
    }
}
