const { ethers, waffle } = require("hardhat");
const { expect } = require("chai");
const { expectRevert, BN } = require("@openzeppelin/test-helpers");

const SOV = artifacts.require("SOV");
const TestToken = artifacts.require("TestToken");
const IV1PoolOracle = artifacts.require("IV1PoolOracle");
const PriceFeeds = artifacts.require("PriceFeeds");
const TestWrbtc = artifacts.require("TestWrbtc");
const PriceFeedV1PoolOracle = artifacts.require("PriceFeedV1PoolOracle");
const LiquidityPoolV1ConverterMockup = artifacts.require("LiquidityPoolV1ConverterMockup");
const PriceFeedRSKOracleMockup = artifacts.require("PriceFeedRSKOracleMockup");
const PriceFeedRSKOracle = artifacts.require("PriceFeedRSKOracle");

const wei = web3.utils.toWei;

const TOTAL_SUPPLY = "10000000000000000000000000";

contract("PriceFeeds", (accounts) => {
	let priceFeeds;
	let sender, receiver;
	let testWrbtc, doc;

	before(async () => {
		[sender, receiver] = await ethers.getSigners();
		tokenSOV = await SOV.new(TOTAL_SUPPLY);

		testToken1 = await TestToken.new("test token 1", "TEST1", 18, wei("20000", "ether"));
		testToken2 = await TestToken.new("test token 2", "TEST2", 16, wei("20000", "ether"));
		testToken1Price = wei("60", "ether");
		testToken2Price = wei("2", "ether");
		docPrice = wei("10", "ether");
		wrBTCPrice = wei("10", "ether");

		testWrbtc = await TestWrbtc.new();
		doc = await TestToken.new("dollar on chain", "DOC", 18, wei("20000", "ether"));
		priceFeeds = await PriceFeeds.new(testWrbtc.address, tokenSOV.address, doc.address);

		liquidityV1ConverterMockupTestToken1 = await LiquidityPoolV1ConverterMockup.new(testToken1.address, testWrbtc.address);
		priceFeedsV1PoolOracleMockupTestToken1 = await waffle.deployMockContract(sender, IV1PoolOracle.abi);
		await priceFeedsV1PoolOracleMockupTestToken1.mock.latestAnswer.returns(testToken1Price);
		await priceFeedsV1PoolOracleMockupTestToken1.mock.liquidityPool.returns(liquidityV1ConverterMockupTestToken1.address);
		priceFeedsV1PoolOracleTestToken1 = await PriceFeedV1PoolOracle.new(
			priceFeedsV1PoolOracleMockupTestToken1.address,
			testWrbtc.address,
			doc.address
		);

		liquidityV1ConverterMockupTestToken2 = await LiquidityPoolV1ConverterMockup.new(testToken2.address, testWrbtc.address);
		priceFeedsV1PoolOracleMockupTestToken2 = await waffle.deployMockContract(sender, IV1PoolOracle.abi);
		await priceFeedsV1PoolOracleMockupTestToken2.mock.latestAnswer.returns(testToken2Price);
		await priceFeedsV1PoolOracleMockupTestToken2.mock.liquidityPool.returns(liquidityV1ConverterMockupTestToken2.address);
		priceFeedsV1PoolOracleTestToken2 = await PriceFeedV1PoolOracle.new(
			priceFeedsV1PoolOracleMockupTestToken2.address,
			testWrbtc.address,
			doc.address
		);

		// Set DOC feed -- price 1 BTC
		liquidityV1ConverterMockupDOC = await LiquidityPoolV1ConverterMockup.new(doc.address, testWrbtc.address);
		priceFeedsV1PoolOracleMockupDOC = await waffle.deployMockContract(sender, IV1PoolOracle.abi);
		await priceFeedsV1PoolOracleMockupDOC.mock.latestAnswer.returns(docPrice);
		await priceFeedsV1PoolOracleMockupDOC.mock.liquidityPool.returns(liquidityV1ConverterMockupDOC.address);
		priceFeedsV1PoolOracleDOC = await PriceFeedV1PoolOracle.new(
			priceFeedsV1PoolOracleMockupDOC.address,
			testWrbtc.address,
			doc.address
		);

		// Set rBTC feed - using rsk oracle
		priceFeedsV1PoolOracleMockupBTC = await PriceFeedRSKOracleMockup.new();
		await priceFeedsV1PoolOracleMockupBTC.setValue(wrBTCPrice);
		priceFeedsV1PoolOracleBTC = await PriceFeedRSKOracle.new(priceFeedsV1PoolOracleMockupBTC.address);

		await priceFeeds.setPriceFeed(
			[testToken1.address, testToken2.address, doc.address, testWrbtc.address],
			[
				priceFeedsV1PoolOracleTestToken1.address,
				priceFeedsV1PoolOracleTestToken2.address,
				priceFeedsV1PoolOracleDOC.address,
				priceFeedsV1PoolOracleBTC.address,
			]
		);

		await priceFeeds.setDecimals([testToken1.address, testToken2.address]);
	});

	describe("PriceFeed unit tests", async () => {
		it("amountInEth for wRBTC token should return passes amount", async () => {
			const wrbtcToken = await priceFeeds.wrbtcToken();
			await expect(await priceFeeds.amountInEth(wrbtcToken, new BN(wei("100", "ether")))).to.be.bignumber.equal(
				new BN(wei("100", "ether"))
			);
		});

		it("getMaxDrawdown collateral token == loan token & comibed > collateral", async () => {
			await expect(
				await priceFeeds.getMaxDrawdown(
					testToken1.address,
					testToken1.address,
					new BN(wei("100", "ether")),
					new BN(wei("100", "ether")),
					new BN(20).mul(new BN(10).pow(new BN(18)))
				)
			).to.be.bignumber.equal(new BN(0));
		});

		it("getMaxDrawdown collateral token == loan token & collateral > combined", async () => {
			await expect(
				await priceFeeds.getMaxDrawdown(
					testToken1.address,
					testToken1.address,
					new BN(wei("100", "ether")),
					new BN(wei("150", "ether")),
					new BN(20).mul(new BN(10).pow(new BN(18)))
				)
			).to.be.bignumber.equal(new BN(wei("30", "ether")));
		});

		it("getMaxDrawdown collateral token != loan token", async () => {
			await expect(
				await priceFeeds.getMaxDrawdown(
					testToken1.address, //mock loan token address
					testToken2.address, //mock collateral token address
					new BN(wei("100", "ether")), //loan token amount
					new BN(wei("150", "ether")), //collateral token amount
					new BN(20).mul(new BN(10).pow(new BN(18)))
				)
			).to.be.bignumber.equal(new BN(wei("114", "ether")));

			await expect(
				await priceFeeds.getMaxDrawdown(
					testToken1.address,
					testToken2.address,
					new BN(wei("100", "ether")),
					new BN(wei("30", "ether")), // <36
					new BN(20).mul(new BN(wei("1", "ether")))
				)
			).to.be.bignumber.equal(new BN(0));
		});

		it("getMaxDrawdown - unsupported src feed", async () => {
			await expectRevert(
				priceFeeds.getMaxDrawdown(
					accounts[9], //mock loan token address
					testToken2.address, //mock collateral token address
					new BN(wei("100", "ether")), //loan token amount
					new BN(wei("150", "ether")), //collateral token amount
					new BN(20).mul(new BN(10).pow(new BN(18)))
				),
				"unsupported src feed"
			);
		});

		it("getMaxDrawdown - unsupported dst feed", async () => {
			await expectRevert(
				priceFeeds.getMaxDrawdown(
					testToken1.address, //mock loan token address
					accounts[9], //mock collateral token address
					new BN(wei("100", "ether")), //loan token amount
					new BN(wei("150", "ether")), //collateral token amount
					new BN(20).mul(new BN(10).pow(new BN(18)))
				),
				"unsupported dst feed"
			);
		});

		it("getCurrentMargin collateralToken == loanToken", async () => {
			let ret = await priceFeeds.getCurrentMargin(
				testToken1.address, //mock loan token address
				testToken1.address, //mock collateral token address
				new BN(wei("100", "ether")), //loan token amount
				new BN(wei("150", "ether")) //collateral token amount
			);
			await expect(ret[0]).to.be.bignumber.equal(new BN(wei("50", "ether")));
			await expect(ret[1]).to.be.bignumber.equal(new BN(wei("1", "ether")));

			ret = await priceFeeds.getCurrentMargin(
				testToken1.address, //mock loan token address
				testToken1.address, //mock collateral token address
				new BN(wei("100", "ether")), //loan token amount
				new BN(wei("30", "ether")) //collateral token amount
			);
			await expect(ret[0]).to.be.bignumber.equal(new BN(0));
			await expect(ret[1]).to.be.bignumber.equal(new BN(wei("1", "ether")));

			ret = await priceFeeds.getCurrentMargin(
				testToken1.address, //mock loan token address
				testToken1.address, //mock collateral token address
				new BN(wei("0", "ether")), //loan token amount
				new BN(wei("30", "ether")) //collateral token amount
			);
			await expect(ret[0]).to.be.bignumber.equal(new BN(0));
			await expect(ret[1]).to.be.bignumber.equal(new BN(wei("1", "ether")));
		});

		it("getCurrentMarginAndCollateralSize", async () => {
			let ret = await priceFeeds.getCurrentMarginAndCollateralSize(
				testToken1.address,
				testToken2.address,
				new BN(wei("100", "ether")), //loan token amount
				new BN(wei("100", "ether")) //collateral token amount
			);
			await expect(ret[0]).to.be.bignumber.equal("233333333333333330000");
			await expect(ret[1]).to.be.bignumber.equal(new BN(wei("200000000000000", "ether")));
		});

		it("shouldLiquidate(...) runs correctly", async () => {
			let ret = await priceFeeds.shouldLiquidate(
				testToken1.address, //mock loan token address
				testToken1.address, //mock collateral token address
				new BN(wei("100", "ether")), //loan token amount
				new BN(wei("150", "ether")), //collateral token amount
				new BN(10).mul(new BN(wei("1", "ether"))) //maintenance margin threshold 10%
			);
			expect(ret).to.be.false; //50<=10

			ret = await priceFeeds.shouldLiquidate(
				testToken1.address,
				testToken2.address,
				new BN(wei("100", "ether")), //loan token amount
				new BN(wei("450", "ether")), //collateral token amount
				new BN(30).mul(new BN(wei("1", "ether"))) //maintenance margin
			);
			expect(ret).to.be.false; //1399<=30

			ret = await priceFeeds.shouldLiquidate(
				testToken1.address,
				testToken2.address,
				new BN(wei("100", "ether")), //loan token amount
				new BN(wei("450", "ether")), //collateral token amount
				new BN(1500).mul(new BN(wei("1", "ether"))) //maintenance margin
			);
			expect(ret).to.be.true; //1399<=1500
		});

		it("setProtocolTokenEthPrice runs correctly", async () => {
			expect(await priceFeeds.protocolTokenEthPrice()).to.be.bignumber.equal(new BN(2).mul(new BN(10).pow(new BN(14))));

			await priceFeeds.setProtocolTokenEthPrice(wei("10", "ether"));
			expect(await priceFeeds.protocolTokenEthPrice()).to.be.bignumber.equal(new BN(wei("10", "ether")));

			await expectRevert(priceFeeds.setProtocolTokenEthPrice(new BN(0)), "invalid price");
			await expectRevert(priceFeeds.setProtocolTokenEthPrice(wei("10", "ether"), { from: accounts[10] }), "unauthorized");
		});

		it("setGlobalPricingPaused", async () => {
			let isPaused = await priceFeeds.globalPricingPaused();
			await priceFeeds.setGlobalPricingPaused(true);
			expect(await priceFeeds.globalPricingPaused()).to.not.equal(isPaused);
			await priceFeeds.setGlobalPricingPaused(false);
			expect(await priceFeeds.globalPricingPaused()).to.equal(isPaused);
		});

		it("setDecimals", async () => {
			testTokens = [];
			let decimals = [];
			for (let i = 0; i < 3; i++) {
				decimals[i] = Math.round(Math.random() * 10 + 8);
				testTokens[i] = await getTestToken({ decimals: decimals[i] });
			}
			await priceFeeds.setDecimals(testTokens.map((item) => item.address));
			for (i = 0; i < 3; i++) {
				expect((await priceFeeds.decimals(await testTokens[i].address)).toNumber()).to.be.eq(decimals[i]);
			}
		});

		it("_queryRate internal", async () => {
			testTokens = [];
			let decimals = [];
			let addresses = [];
			for (let i = 0; i < 2; i++) {
				decimals[i] = (i + 1) * 10 + i;
				testTokens[i] = await getTestToken({ decimals: decimals[i] });
				addresses[i] = testTokens[i].address;
			}
			expect(await priceFeeds.queryPrecision(addresses[0], addresses[0])).to.be.bignumber.equal(new BN(wei("1", "ether")));
			expect(await priceFeeds.queryPrecision(addresses[1], addresses[1])).to.be.bignumber.equal(new BN(wei("1", "ether")));
			//source decimals > dest decimals
			expect(await priceFeeds.queryPrecision(addresses[1], addresses[0])).to.be.bignumber.equal(new BN(10).pow(new BN(29))); //10^7 (18+diff)
			//source decimals < dest decimals
			expect(await priceFeeds.queryPrecision(addresses[0], addresses[1])).to.be.bignumber.equal(new BN(10).pow(new BN(7))); //10^29 (18-diff)
		});

		it("queryPrecision source token = dest token", async () => {
			expect(await priceFeeds.queryPrecision(testToken1.address, testToken1.address)).to.be.bignumber.equal(
				new BN(wei("1", "ether"))
			);
		});

		it("should return destination token amount", async () => {
			await expect(
				await priceFeeds.queryReturn(testToken1.address, testToken2.address, new BN(wei("100", "ether")))
			).to.be.bignumber.equal(new BN(wei("30", "ether")));
		});

		it("should return default values when source token = dest token", async () => {
			let ret = await priceFeeds.queryRate(testToken1.address, testToken1.address);
			await expect(ret[0]).to.be.bignumber.equal(new BN(wei("1", "ether")));
			await expect(ret[1]).to.be.bignumber.equal(new BN(wei("1", "ether")));
		});

		it("should have price disagreements", async () => {
			await expectRevert(
				priceFeeds.checkPriceDisagreement(
					testToken1.address,
					testToken2.address,
					new BN(wei("100", "ether")),
					new BN(wei("150", "ether")),
					new BN(10).mul(new BN(wei("1", "ether")))
				),
				"price disagreement"
			);
		});

		it("should return 0 destination token amount when paused", async () => {
			await priceFeeds.setGlobalPricingPaused(true);
			await expect(
				await priceFeeds.queryReturn(testToken1.address, testToken2.address, new BN(wei("100", "ether")))
			).to.be.bignumber.equal(new BN(wei("0", "ether")));
		});

		it("should not check price disagreements when paused", async () => {
			await expectRevert(
				priceFeeds.checkPriceDisagreement(
					testToken1.address,
					testToken2.address,
					new BN(wei("100", "ether")),
					new BN(wei("150", "ether")),
					new BN(10).mul(new BN(wei("1", "ether")))
				),
				"pricing is paused"
			);
		});

		it("should revert for count mismatch while setting PriceFeed", async () => {
			await expectRevert(
				priceFeeds.setPriceFeed(
					[testToken1.address, testToken2.address, doc.address, testWrbtc.address],
					[priceFeedsV1PoolOracleTestToken1.address, priceFeedsV1PoolOracleTestToken2.address, priceFeedsV1PoolOracleDOC.address]
				),
				"count mismatch"
			);
		});

		const getTestToken = async ({ decimals = 18, totalSupply = wei("100000000", "ether") }) => {
			const token = await TestToken.new("TST", "TST", decimals, totalSupply);
			return token;
		};
	});
});
