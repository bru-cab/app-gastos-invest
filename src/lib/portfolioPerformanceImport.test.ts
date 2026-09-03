import { describe, expect, it } from "vitest";
import { parsePortfolioPerformanceXml } from "./portfolioPerformanceImport";

describe("parsePortfolioPerformanceXml", () => {
  it("builds holdings from full portfolio nodes and honors the selected filter", () => {
    const xml = `
      <client>
        <securities>
          <security>
            <uuid>a</uuid>
            <name>Bitcoin</name>
            <tickerSymbol>BTC-USD</tickerSymbol>
            <latest t="2026-09-02" v="7707414000000"/>
          </security>
          <security>
            <uuid>b</uuid>
            <name>Meta Platforms, Inc.</name>
            <tickerSymbol>META</tickerSymbol>
            <prices>
              <price t="2026-09-01" v="59000000000"/>
              <price t="2026-09-02" v="59285000000"/>
            </prices>
          </security>
        </securities>
        <accounts>
          <account>
            <uuid>cash-a</uuid>
            <name>Cash</name>
            <transactions>
              <account-transaction>
                <crossEntry class="buysell">
                  <portfolio>
                    <uuid>portfolio-a</uuid>
                    <name>Core</name>
                    <transactions>
                      <portfolio-transaction>
                        <security reference="../../../../../../../../../securities/security"/>
                        <shares>150000000</shares>
                        <type>BUY</type>
                      </portfolio-transaction>
                      <portfolio-transaction>
                        <security reference="../../../../../../../../../securities/security[2]"/>
                        <shares>200000000</shares>
                        <type>BUY</type>
                      </portfolio-transaction>
                      <portfolio-transaction>
                        <security reference="../../../../../../../../../securities/security[2]"/>
                        <shares>50000000</shares>
                        <type>SELL</type>
                      </portfolio-transaction>
                    </transactions>
                  </portfolio>
                </crossEntry>
              </account-transaction>
              <account-transaction>
                <crossEntry class="buysell">
                  <portfolio>
                    <uuid>portfolio-b</uuid>
                    <name>Excluded</name>
                    <transactions>
                      <portfolio-transaction>
                        <security reference="../../../../../../../../../securities/security"/>
                        <shares>50000000</shares>
                        <type>BUY</type>
                      </portfolio-transaction>
                    </transactions>
                  </portfolio>
                </crossEntry>
              </account-transaction>
            </transactions>
          </account>
        </accounts>
        <settings>
          <configurationSets>
            <entry>
              <string>client-filter-definitions</string>
              <config-set>
                <configurations>
                  <config>
                    <uuid>filter-1</uuid>
                    <name>Relevants</name>
                    <data>portfolio-a</data>
                  </config>
                </configurations>
              </config-set>
            </entry>
            <entry>
              <string>client-filter-selection</string>
              <config-set>
                <configurations>
                  <config>
                    <uuid>SecuritiesPerformanceView</uuid>
                    <data>filter-1</data>
                  </config>
                </configurations>
              </config-set>
            </entry>
          </configurationSets>
        </settings>
      </client>
    `;

    const result = parsePortfolioPerformanceXml(xml, "sample.xml");

    expect(result.holdings).toHaveLength(2);
    expect(result.filterName).toBe("Relevants");
    expect(result.holdings[0]).toMatchObject({ symbol: "BTC-USD", shares: 1.5, lastPriceDate: "2026-09-02" });
    expect(result.holdings[1]).toMatchObject({ symbol: "META", shares: 1.5, lastPrice: 592.85 });
  });
});
