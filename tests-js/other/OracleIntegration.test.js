const { expectRevert, expectEvent } = require("@openzeppelin/test-helpers");
const BN = require("bn.js");
const { expect } = require("chai");
const PriceFeedsMoC = artifacts.require("PriceFeedsMoC");
const PriceFeeds = artifacts.require("PriceFeeds");
const PriceFeedsMoCMockup = artifacts.require("PriceFeedsMoCMockup");
const PriceFeedRSKOracleMockup = artifacts.require("PriceFeedRSKOracleMockup");
const SwapsImplSovrynSwap = artifacts.require("SwapsImplSovrynSwap");

const { getSUSD, getRBTC, getWRBTC, getBZRX, getSovryn, getPriceFeeds } = require("../Utils/initializer.js");

contract("OracleIntegration", (accounts) => {
	let sovryn, SUSD, WRBTC, RBTC, BZRX, priceFeeds, swapsImpl;

	beforeEach(async () => {
		SUSD = await getSUSD();
		RBTC = await getRBTC();
		WRBTC = await getWRBTC();
		BZRX = await getBZRX();
		priceFeeds = await getPriceFeeds(WRBTC, SUSD, RBTC, sovryn, BZRX);

		sovryn = await getSovryn(WRBTC, SUSD, RBTC, priceFeeds);
		swapsImpl = await SwapsImplSovrynSwap.new();
	});

	const set_oracle = async (price_feed_rsk_mockup, oracle_address = sovryn.address) => {
		const price_feeds_moc = await PriceFeedsMoC.new(oracle_address, price_feed_rsk_mockup);
		const price_feeds = await PriceFeeds.new(WRBTC.address, BZRX.address, SUSD.address);

		await price_feeds.setPriceFeed([BZRX.address, WRBTC.address], [price_feeds_moc.address, price_feeds_moc.address]);

		await sovryn.setPriceFeedContract(
			price_feeds.address // priceFeeds
		);

		await sovryn.setSwapsImplContract(
			swapsImpl.address // swapsImpl
		);

		return [price_feeds, price_feeds_moc];
	};

	const price_feed_moc_mockup = async () => {
		const price_feeds_moc_mockup = await PriceFeedsMoCMockup.new();
		await price_feeds_moc_mockup.setHas(true);
		await price_feeds_moc_mockup.setValue(new BN(10).pow(new BN(22)));
		return price_feeds_moc_mockup;
	};
	const price_feed_rsk_mockup = async () => {
		const price_feed_rsk_mockup = await PriceFeedRSKOracleMockup.new();
		await price_feed_rsk_mockup.setHas(true);
		await price_feed_rsk_mockup.setValue(new BN(10).pow(new BN(20)));
		return price_feed_rsk_mockup;
	};

	describe("OracleIntegration Tests", () => {
		it("Test moc oracle integration", async () => {
			const [price_feeds, price_feeds_moc] = await set_oracle(
				(
					await price_feed_rsk_mockup()
				).address,
				(
					await price_feed_moc_mockup()
				).address
			);

			let res = await price_feeds.queryPrecision(BZRX.address, WRBTC.address);
			expect(res.eq(new BN(10).pow(new BN(18)))).to.be.true;

			res = await price_feeds_moc.latestAnswer();
			expect(res.eq(new BN(10).pow(new BN(22)))).to.be.true;
		});

		it("Test set moc oracle address", async () => {
			const [, price_feeds_moc] = await set_oracle((await price_feed_rsk_mockup()).address);
			expectEvent(await price_feeds_moc.setMoCOracleAddress(BZRX.address), "SetMoCOracleAddress", {
				mocOracleAddress: BZRX.address,
				changerAddress: accounts[0],
			});
			expect((await price_feeds_moc.mocOracleAddress()) == BZRX.address).to.be.true;
		});

		it("Test set moc oracle address unauthorized user should fail", async () => {
			const [, price_feeds_moc] = await set_oracle((await price_feed_rsk_mockup()).address);
			await expectRevert(price_feeds_moc.setMoCOracleAddress(BZRX.address, { from: accounts[1] }), "unauthorized");
		});

		it("Test get price from rsk when hasValue false", async () => {
			const price_feed_mockup = await price_feed_moc_mockup();
			await price_feed_mockup.setHas(false);
			const [, price_feeds_moc] = await set_oracle((await price_feed_rsk_mockup()).address, price_feed_mockup.address);
			const res = await price_feeds_moc.latestAnswer();
			expect(res.eq(new BN(10).pow(new BN(20)))).to.be.true;
		});
	});
});
