import { describe, expect, it } from "vitest";
import { parsePortfolioPerformanceXml } from "./portfolioPerformanceImport";

describe("parsePortfolioPerformanceXml", () => {
  it("builds holdings from buy and sell transactions", () => {
    const xml = `
      <client>
        <securities>
          <security>
            <uuid>a</uuid>
            <name>Bitcoin</name>
            <tickerSymbol>BTC-USD</tickerSymbol>
            <latest t="2026-09-02" v="7707414000000" />
          </security>
          <security>
            <uuid>b</uuid>
            <name>Meta Platforms, Inc.</name>
            <tickerSymbol>META</tickerSymbol>
            <latest t="2026-09-02" v="59285000000" />
          </security>
        </securities>
        <portfolio-transaction>
          <security reference="../../securities/security" />
          <shares>1500000</shares>
          <type>BUY</type>
        </portfolio-transaction>
        <portfolio-transaction>
          <security reference="../../securities/security[2]" />
          <shares>2000000</shares>
          <type>BUY</type>
        </portfolio-transaction>
        <portfolio-transaction>
          <security reference="../../securities/security[2]" />
          <shares>500000</shares>
          <type>SELL</type>
        </portfolio-transaction>
      </client>
    `;

    const result = parsePortfolioPerformanceXml(xml, "sample.xml");

    expect(result.holdings).toHaveLength(2);
    expect(result.holdings[0]).toMatchObject({ symbol: "BTC-USD", shares: 1.5, lastPriceDate: "2026-09-02" });
    expect(result.holdings[1]).toMatchObject({ symbol: "META", shares: 1.5, lastPrice: 592.85 });
  });
});
