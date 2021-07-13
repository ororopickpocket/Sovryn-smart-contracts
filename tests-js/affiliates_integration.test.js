const { assert } = require("chai");
const { waffle } = require('hardhat');
const { deployMockContract } = waffle;
const LoanTokenLogicStandard = artifacts.require("LoanTokenLogicStandard");
const sovrynProtocol = artifacts.require("sovrynProtocol");
const LoanToken = artifacts.require("LoanToken");
const LockedSOV = artifacts.require("LockedSOV");
const StakingLogic = artifacts.require("Staking");
const StakingProxy = artifacts.require("StakingProxy");
const FeeSharingProxy = artifacts.require("FeeSharingProxyMockup");
const VestingLogic = artifacts.require("VestingLogic");
const VestingFactory = artifacts.require("VestingFactory");
const VestingRegistry = artifacts.require("VestingRegistry3");

const TestWrbtc = artifacts.require("TestWrbtc");
const TestToken = artifacts.require("TestToken");
const SOV = artifacts.require("SOV");
const ISovryn = artifacts.require("ISovryn");
const ProtocolSettings = artifacts.require("ProtocolSettings");
const LoanSettings = artifacts.require("LoanSettings");
const LoanMaintenance = artifacts.require("LoanMaintenance");
const LoanOpenings = artifacts.require("LoanOpenings");
const SwapsExternal = artifacts.require("SwapsExternal");
const LoanClosingsBase = artifacts.require("LoanClosingsBase");
const LoanClosingsWith = artifacts.require("LoanClosingsWith");

const PriceFeedsLocal = artifacts.require("PriceFeedsLocal");
const PriceFeeds = artifacts.require("PriceFeeds");
const PriceFeedRSKOracle = artifacts.require("PriceFeedRSKOracle");
const PriceFeedRSKOracleMockup = artifacts.require("PriceFeedRSKOracleMockup");
const PriceFeedV1PoolOracle = artifacts.require("PriceFeedV1PoolOracle");
const LiquidityPoolV1ConverterMockup = artifacts.require("LiquidityPoolV1ConverterMockup");
const TestSovrynSwap = artifacts.require("TestSovrynSwap");
const SwapsImplSovrynSwap = artifacts.require("SwapsImplSovrynSwap");
const Affiliates = artifacts.require("Affiliates");
const IV1PoolOracle = artifacts.require("IV1PoolOracle")


const { BN, constants, send, expectEvent, expectRevert } = require("@openzeppelin/test-helpers");
const { expect } = require("hardhat");

const TOTAL_SUPPLY = "10000000000000000000000000";

const { decodeLogs } = require("./Utils/initializer.js");
let cliff = 1; // This is in 4 weeks. i.e. 1 * 4 weeks.
let duration = 11; // This is in 4 weeks. i.e. 11 * 4 weeks.

contract("Affiliates", (accounts) => {
	let loanTokenLogic;
	let testWrbtc;
	let doc;
	let tokenSOV;
	let lockedSOV;
	let sovryn;
	let loanTokenV2;
	let feeds;
	let wei = web3.utils.toWei;
	let senderMock;
	before(async () => {
		[owner, trader, referrer, account1, account2, ...accounts] = accounts;
	});
	beforeEach(async () => {
		const provider = waffle.provider;
		[senderMock] = provider.getWallets();

		// Deploying sovrynProtocol
		const sovrynproxy = await sovrynProtocol.new();
		sovryn = await ISovryn.at(sovrynproxy.address);

		await sovryn.replaceContract((await LoanClosingsBase.new()).address);
		await sovryn.replaceContract((await LoanClosingsWith.new()).address);
		await sovryn.replaceContract((await ProtocolSettings.new()).address);
		await sovryn.replaceContract((await LoanSettings.new()).address);
		await sovryn.replaceContract((await LoanMaintenance.new()).address);
		await sovryn.replaceContract((await SwapsExternal.new()).address);
		await sovryn.replaceContract((await LoanOpenings.new()).address);
		await sovryn.replaceContract((await Affiliates.new()).address);

		await sovryn.setSovrynProtocolAddress(sovrynproxy.address);

		loanTokenLogic = await LoanTokenLogicStandard.new();
		testWrbtc = await TestWrbtc.new();
		doc = await TestToken.new("dollar on chain", "DOC", 18, wei("20000", "ether"));
		tokenSOV = await SOV.new(TOTAL_SUPPLY);
		loanToken = await LoanToken.new(owner, loanTokenLogic.address, sovryn.address, testWrbtc.address);
		await loanToken.initialize(doc.address, "SUSD", "SUSD");

		// loanTokenV2 = await LoanTokenLogicStandard.at(loanToken.address);
		loanTokenV2 = await LoanTokenLogicStandard.at(loanToken.address); //mocked for ad-hoc logic for isolated testing
		const loanTokenAddress = await loanToken.loanTokenAddress();
		if (owner == (await sovryn.owner())) {
			await sovryn.setLoanPool([loanTokenV2.address], [loanTokenAddress]);
		}

		// Creating the Staking Instance.
		stakingLogic = await StakingLogic.new(tokenSOV.address);
		staking = await StakingProxy.new(tokenSOV.address);
		await staking.setImplementation(stakingLogic.address);
		staking = await StakingLogic.at(staking.address);

		// Creating the FeeSharing Instance.
		feeSharingProxy = await FeeSharingProxy.new(constants.ZERO_ADDRESS, staking.address);

		// Creating the Vesting Instance.
		vestingLogic = await VestingLogic.new();
		vestingFactory = await VestingFactory.new(vestingLogic.address);
		vestingRegistry = await VestingRegistry.new(
			vestingFactory.address,
			tokenSOV.address,
			staking.address,
			feeSharingProxy.address,
			owner // This should be Governance Timelock Contract.
		);
		vestingFactory.transferOwnership(vestingRegistry.address);

		// Creating the instance of newLockedSOV Contract.
		await sovryn.setLockedSOVAddress(
			(
				await LockedSOV.new(tokenSOV.address, vestingRegistry.address, cliff, duration, [owner])
			).address
		);
		lockedSOV = await LockedSOV.at(await sovryn.lockedSOVAddress());
	});
	let swapsSovryn;
	beforeEach(async () => {
		//initialize
		feeds = await PriceFeedsLocal.new(testWrbtc.address, sovryn.address);
		await feeds.setRates(doc.address, testWrbtc.address, wei("0.01", "ether"));
		swapsSovryn = await SwapsImplSovrynSwap.new();
		const sovrynSwapSimulator = await TestSovrynSwap.new(feeds.address);
		await sovryn.setSovrynSwapContractRegistryAddress(sovrynSwapSimulator.address);
		await sovryn.setSupportedTokens([doc.address, testWrbtc.address], [true, true]);
		await sovryn.setPriceFeedContract(
			feeds.address //priceFeeds
		);
		await sovryn.setSwapsImplContract(
			swapsSovryn.address // swapsImpl
		);
		await sovryn.setFeesController(owner);
		await sovryn.setWrbtcToken(testWrbtc.address);
		await sovryn.setSOVTokenAddress(tokenSOV.address);
		await sovryn.setProtocolTokenAddress(sovryn.address);

		{
			/**
			struct LoanParams {
				bytes32 id; // id of loan params object
				bool active; // if false, this object has been disabled by the owner and can't be used for future loans
				address owner; // owner of this object
				address loanToken; // the token being loaned
				address collateralToken; // the required collateral token
				uint256 minInitialMargin; // the minimum allowed initial margin
				uint256 maintenanceMargin; // an unhealthy loan when current margin is at or below this value
				uint256 maxLoanTerm; // the maximum term for new loans (0 means there's no max term)
			}
		*/
		}
		params = [
			"0x0000000000000000000000000000000000000000000000000000000000000000", // bytes32 id; // id of loan params object
			false, // bool active; // if false, this object has been disabled by the owner and can't be used for future loans
			owner, // address owner; // owner of this object
			doc.address, // address loanToken; // the token being loaned
			testWrbtc.address, // address collateralToken; // the required collateral token
			wei("20", "ether"), // uint256 minInitialMargin; // the minimum allowed initial margin
			wei("15", "ether"), // uint256 maintenanceMargin; // an unhealthy loan when current margin is at or below this value
			2419200, // uint256 maxLoanTerm; // the maximum term for new loans (0 means there's no max term)
		];

		//await loanTokenV2.setupLoanParams([params], true);
		await loanTokenV2.setupLoanParams([params], false);

		// setting up interest rates
		const baseRate = wei("1", "ether");
		const rateMultiplier = wei("20.25", "ether");
		const targetLevel = wei("80", "ether");
		const kinkLevel = wei("90", "ether");
		const maxScaleRate = wei("100", "ether");
		await loanTokenV2.setDemandCurve(baseRate, rateMultiplier, baseRate, rateMultiplier, targetLevel, kinkLevel, maxScaleRate);

		// GIVING SOME DOC tokens to loanToken so that we can borrow from loanToken
		await doc.transfer(loanTokenV2.address, wei("500", "ether"));
		await doc.transfer(trader, wei("100", "ether"));
		//trader approves to LoanToken loan amount for trading
		await doc.approve(loanToken.address, web3.utils.toWei("100", "ether"), { from: trader });
		//Giving some testRbtc to sovrynAddress (by minting some testRbtc),so that it can open position in wRBTC.
		await testWrbtc.mint(sovryn.address, wei("500", "ether"));

		//Giving some SOV Token to sovrynAddress (For affiliates rewards purposes)
		await tokenSOV.mint(sovryn.address, wei("500", "ether"));
	});

	it("Test affiliates integration with underlying token", async () => {
		//  Change the min referrals to payout to 3 for testing purposes
		await sovryn.setMinReferralsToPayoutAffiliates(3);
		loanTokenLogic = await LoanTokenLogicStandard.new();

		const loanTokenSent = wei("21", "ether");
		const leverageAmount = web3.utils.toWei("2", "ether");
		// underlyingToken.approve(loanTokenV2.address, loanTokenSent*2)

		let previousAffiliateRewardsHeld = await sovryn.affiliateRewardsHeld(referrer);
		let tx = await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // Leverage
			loanTokenSent, // loanTokenSent
			0, //
			testWrbtc.address, // collateralTokenAddress
			trader, // trader
			referrer, // referrer address
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);

		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "SetAffiliatesReferrer", {
			user: trader,
			referrer: referrer,
		});

		let referrerOnChain = await sovryn.affiliatesUserReferrer(trader);
		expect(referrerOnChain, "Incorrect User Affiliate").to.be.equal(referrer);

		notFirstTradeFlagOnChain = await sovryn.getUserNotFirstTradeFlag(trader);
		expect(notFirstTradeFlagOnChain, "First trade flag is not updated").to.be.true;

		let event_name = "PayTradingFeeToAffiliate";
		let decode = decodeLogs(tx.receipt.rawLogs, Affiliates, event_name);
		let referrerFee = await sovryn.affiliatesReferrerBalances(referrer, doc.address);
		if (!decode.length) {
			throw "Event PayTradingFeeToAffiliate is not fired properly";
		}

		let isHeld = decode[0].args["isHeld"];
		let affiliateRewardsHeld = await sovryn.affiliateRewardsHeld(referrer);
		let submittedAffiliatesReward = decode[0].args["sovBonusAmount"];
		let submittedTokenBonusAmount = decode[0].args["tokenBonusAmount"];
		let submittedReferrer = decode[0].args["referrer"];
		let submittedTrader = decode[0].args["trader"];
		expect(isHeld, "First trade affiliates reward must be in held").to.be.true;
		expect(referrerFee.toString(), "Token bonus rewards is not matched").to.be.equal(submittedTokenBonusAmount.toString());

		let checkedValueShouldBe = affiliateRewardsHeld - previousAffiliateRewardsHeld;
		expect(checkedValueShouldBe.toString(), "Affiliates bonus rewards is not matched").to.be.equal(
			submittedAffiliatesReward.toString()
		);

		// Check lockedSOV Balance of the referrer
		let referrerBalanceInLockedSOV = await lockedSOV.getLockedBalance(referrer);
		expect(referrerBalanceInLockedSOV.toString(), "Referrer balance in lockedSOV is not matched").to.be.equal(new BN(0).toString());

		expect(submittedReferrer).to.eql(referrer);
		expect(submittedTrader).to.eql(trader);

		// Change the min referrals to payout to 1
		await sovryn.setMinReferralsToPayoutAffiliates(1);

		previousAffiliateRewardsHeld = await sovryn.affiliateRewardsHeld(referrer);
		tx = await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // Leverage
			loanTokenSent, // loanTokenSent
			0, //
			testWrbtc.address, // collateralTokenAddress
			trader, // trader
			referrer, // referrer address
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);

		decode = decodeLogs(tx.receipt.rawLogs, Affiliates, event_name);
		if (!decode.length) {
			throw "Event PayTradingFeeToAffiliate is not fired properly";
		}

		isHeld = decode[0].args["isHeld"];
		expect(isHeld, "First trade affiliates reward must not be in held").to.be.false;

		affiliateRewardsHeld = await sovryn.affiliateRewardsHeld(referrer);
		submittedAffiliatesReward = decode[0].args["sovBonusAmount"];
		submittedTokenBonusAmount = decode[0].args["tokenBonusAmount"];
		sovBonusAmountPaid = decode[0].args["sovBonusAmountPaid"];
		submittedReferrer = decode[0].args["referrer"];
		submittedTrader = decode[0].args["trader"];

		expect(affiliateRewardsHeld.toString(), "affiliateRewardHeld should be zero at this point").to.be.equal(new BN(0).toString());
		expect(referrerFee.toString(), "Token bonus rewards is not matched").to.be.equal(submittedTokenBonusAmount.toString());

		checkSovBonusAmountPaid = new BN(submittedAffiliatesReward).add(new BN(previousAffiliateRewardsHeld));
		expect(checkSovBonusAmountPaid.toString(), "Affiliates bonus rewards paid is not matched").to.be.equal(
			sovBonusAmountPaid.toString()
		);

		checkedValueShouldBe = new BN(affiliateRewardsHeld).add(new BN(previousAffiliateRewardsHeld));
		expect(checkedValueShouldBe.toString(), "Affiliates bonus rewards is not matched").to.be.equal(
			submittedAffiliatesReward.toString()
		);

		// Check lockedSOV Balance of the referrer
		referrerBalanceInLockedSOV = await lockedSOV.getLockedBalance(referrer);
		expect(referrerBalanceInLockedSOV.toString(), "Referrer balance in lockedSOV is not matched").to.be.equal(
			checkSovBonusAmountPaid.toString()
		);

		expect(submittedReferrer).to.eql(referrer);
		expect(submittedTrader).to.eql(trader);

		// Do withdrawal
		let referrerTokenBalance = await doc.balanceOf(referrer);
		let referrerFee2 = new BN(referrerFee).add(new BN(submittedTokenBonusAmount));
		tx = await sovryn.withdrawAllAffiliatesReferrerTokenFees(referrer, { from: referrer });
		const referrerFeeAfterWithdrawal = await sovryn.affiliatesReferrerBalances(referrer, doc.address);
		let referrerTokenBalanceAfterWithdrawal = await doc.balanceOf(referrer);
		expect(referrerFeeAfterWithdrawal, "Incorrect all balance after all DoC withdraw").to.be.bignumber.equal(new BN(0));
		expect(referrerTokenBalanceAfterWithdrawal.sub(referrerTokenBalance).toString()).to.be.equal(referrerFee2.toString());

		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "WithdrawAffiliatesReferrerTokenFees", {
			referrer: referrer,
			receiver: referrer,
			tokenAddress: doc.address,
			amount: referrerFee2.toString(),
		});
	});

	it("Test affiliates integration with underlying token with oracle v1Pool", async () => {
		feeds = await PriceFeeds.new(testWrbtc.address, tokenSOV.address, doc.address);
		testToken1Precision = 18;
		testToken2Precision = 18;
		btcPrecision = 8;
		testToken1 = await TestToken.new("test token 1", "TEST1", testToken1Precision, wei("20000", "ether"));
		testToken2 = await TestToken.new("test token 2", "TEST2", testToken2Precision, wei("20000", "ether"));
		testToken1Price = wei("2", "ether");
		testToken2Price = wei("2", "ether");
		wrBTCPrice = wei("8", "ether");
		docPrice = wei("7", "ether");

		// Set tetToken1 feed - price 1Z BTC
		// Set v1 convert mockup
		liquidityV1ConverterMockupTestToken1 = await LiquidityPoolV1ConverterMockup.new(testToken1.address, testWrbtc.address);

		priceFeedsV1PoolOracleMockupTestToken1 = await deployMockContract(senderMock, IV1PoolOracle.abi);
		await priceFeedsV1PoolOracleMockupTestToken1.mock.latestAnswer.returns(testToken1Price);
		await priceFeedsV1PoolOracleMockupTestToken1.mock.liquidityPool.returns(liquidityV1ConverterMockupTestToken1.address);

		priceFeedsV1PoolOracleTestToken1 = await PriceFeedV1PoolOracle.new(
			priceFeedsV1PoolOracleMockupTestToken1.address,
			testWrbtc.address,
			doc.address
		);

		liquidityV1ConverterMockupTestToken2 = await LiquidityPoolV1ConverterMockup.new(testToken2.address, testWrbtc.address);
		priceFeedsV1PoolOracleMockupTestToken2 = await deployMockContract(senderMock, IV1PoolOracle.abi);
		await priceFeedsV1PoolOracleMockupTestToken2.mock.latestAnswer.returns(testToken2Price);
		await priceFeedsV1PoolOracleMockupTestToken2.mock.liquidityPool.returns(liquidityV1ConverterMockupTestToken2.address);

		priceFeedsV1PoolOracleTestToken2 = await PriceFeedV1PoolOracle.new(
			priceFeedsV1PoolOracleMockupTestToken2.address,
			testWrbtc.address,
			doc.address
		);

		// // Set rBTC feed - using rsk oracle
		priceFeedsV1PoolOracleMockupBTC = await PriceFeedRSKOracleMockup.new();
		await priceFeedsV1PoolOracleMockupBTC.setValue(wrBTCPrice);
		priceFeedsV1PoolOracleBTC = await PriceFeedRSKOracle.new(priceFeedsV1PoolOracleMockupBTC.address);

		// Set DOC feed -- price 1 BTC
		liquidityV1ConverterMockupDOC = await LiquidityPoolV1ConverterMockup.new(doc.address, testWrbtc.address);
		
		priceFeedsV1PoolOracleMockupDOC = await deployMockContract(senderMock, IV1PoolOracle.abi);
		await priceFeedsV1PoolOracleMockupDOC.mock.latestAnswer.returns(docPrice);
		await priceFeedsV1PoolOracleMockupDOC.mock.liquidityPool.returns(liquidityV1ConverterMockupDOC.address);

		priceFeedsV1PoolOracleDOC = await PriceFeedV1PoolOracle.new(
			priceFeedsV1PoolOracleMockupDOC.address,
			testWrbtc.address,
			doc.address
		);

		// await feeds.setPriceFeed([testWrbtc.address, doc.address], [priceFeedsV1PoolOracle.address, priceFeedsV1PoolOracle.address])
		await feeds.setPriceFeed(
			[testToken1.address, testToken2.address, doc.address, testWrbtc.address],
			[
				priceFeedsV1PoolOracleTestToken1.address,
				priceFeedsV1PoolOracleTestToken2.address,
				priceFeedsV1PoolOracleDOC.address,
				priceFeedsV1PoolOracleBTC.address,
			]
		);

		test1 = await feeds.queryRate(testToken1.address, doc.address);
		expect(test1[0].toString()).to.be.equal(
			new BN(testToken1Price)
				.mul(new BN(wrBTCPrice))
				.mul(new BN(10 ** (testToken1Precision - btcPrecision)))
				.div(new BN(wei("1", "ether")))
				.toString()
		);

		test = await feeds.queryReturn(testToken1.address, doc.address, wei("2", "ether"));
		expect(test.toString()).to.be.equal(
			new BN(2)
				.mul(
					new BN(testToken1Price)
						.mul(new BN(wrBTCPrice))
						.mul(new BN(10 ** (testToken1Precision - btcPrecision)))
						.div(new BN(wei("1", "ether")))
				)
				.toString()
		);

		test1 = await feeds.queryRate(testToken1.address, testToken2.address);

		expect(test1[0].toString()).to.be.equal(
			new BN(testToken1Price)
				.div(new BN(testToken2Price))
				.mul(new BN(wei("1", "ether")))
				.toString()
		);
		test = await feeds.queryReturn(testToken1.address, testToken2.address, wei("2", "ether"));
		expect(test.toString()).to.be.equal(
			new BN(2).mul(new BN(testToken1Price).div(new BN(testToken2Price)).mul(new BN(wei("1", "ether")))).toString()
		);

		swapsSovryn = await SwapsImplSovrynSwap.new();
		const sovrynSwapSimulator = await TestSovrynSwap.new(feeds.address);
		await sovryn.setSovrynSwapContractRegistryAddress(sovrynSwapSimulator.address);
		await sovryn.setSupportedTokens([doc.address, testWrbtc.address], [true, true]);
		await sovryn.setPriceFeedContract(
			feeds.address //priceFeeds
		);
		await sovryn.setSwapsImplContract(
			swapsSovryn.address // swapsImpl
		);
		await sovryn.setFeesController(owner);
		await sovryn.setWrbtcToken(testWrbtc.address);
		await sovryn.setSOVTokenAddress(tokenSOV.address);

		//  Change the min referrals to payout to 3 for testing purposes
		await sovryn.setMinReferralsToPayoutAffiliates(3);
		loanTokenLogic = await LoanTokenLogicStandard.new();

		const loanTokenSent = wei("21", "ether");
		const leverageAmount = web3.utils.toWei("2", "ether");
		// underlyingToken.approve(loanTokenV2.address, loanTokenSent*2)

		let previousAffiliateRewardsHeld = await sovryn.affiliateRewardsHeld(referrer);
		let tx = await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // Leverage
			loanTokenSent, // loanTokenSent
			0, //
			testWrbtc.address, // collateralTokenAddress
			trader, // trader
			referrer, // referrer address
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);

		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "SetAffiliatesReferrer", {
			user: trader,
			referrer: referrer,
		});

		let referrerOnChain = await sovryn.affiliatesUserReferrer(trader);
		expect(referrerOnChain, "Incorrect User Affiliate").to.be.equal(referrer);

		notFirstTradeFlagOnChain = await sovryn.getUserNotFirstTradeFlag(trader);
		expect(notFirstTradeFlagOnChain, "First trade flag is not updated").to.be.true;

		let event_name = "PayTradingFeeToAffiliate";
		let decode = decodeLogs(tx.receipt.rawLogs, Affiliates, event_name);
		let referrerFee = await sovryn.affiliatesReferrerBalances(referrer, doc.address);
		if (!decode.length) {
			throw "Event PayTradingFeeToAffiliate is not fired properly";
		}

		let isHeld = decode[0].args["isHeld"];
		let affiliateRewardsHeld = await sovryn.affiliateRewardsHeld(referrer);
		let submittedAffiliatesReward = decode[0].args["sovBonusAmount"];
		let submittedTokenBonusAmount = decode[0].args["tokenBonusAmount"];
		expect(isHeld, "First trade affiliates reward must be in held").to.be.true;
		expect(referrerFee.toString(), "Token bonus rewards is not matched").to.be.equal(submittedTokenBonusAmount.toString());

		let checkedValueShouldBe = affiliateRewardsHeld - previousAffiliateRewardsHeld;
		expect(checkedValueShouldBe.toString(), "Affiliates bonus rewards is not matched").to.be.equal(
			submittedAffiliatesReward.toString()
		);

		// Check lockedSOV Balance of the referrer
		let referrerBalanceInLockedSOV = await lockedSOV.getLockedBalance(referrer);
		expect(referrerBalanceInLockedSOV.toString(), "Referrer balance in lockedSOV is not matched").to.be.equal(new BN(0).toString());

		// Change the min referrals to payout to 1
		await sovryn.setMinReferralsToPayoutAffiliates(1);

		previousAffiliateRewardsHeld = await sovryn.affiliateRewardsHeld(referrer);
		tx = await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // Leverage
			loanTokenSent, // loanTokenSent
			0, //
			testWrbtc.address, // collateralTokenAddress
			trader, // trader
			referrer, // referrer address
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);

		decode = decodeLogs(tx.receipt.rawLogs, Affiliates, event_name);
		if (!decode.length) {
			throw "Event PayTradingFeeToAffiliate is not fired properly";
		}

		isHeld = decode[0].args["isHeld"];
		expect(isHeld, "First trade affiliates reward must not be in held").to.be.false;

		affiliateRewardsHeld = await sovryn.affiliateRewardsHeld(referrer);
		submittedAffiliatesReward = decode[0].args["sovBonusAmount"];
		submittedTokenBonusAmount = decode[0].args["tokenBonusAmount"];
		sovBonusAmountPaid = decode[0].args["sovBonusAmountPaid"];

		expect(affiliateRewardsHeld.toString(), "affiliateRewardHeld should be zero at this point").to.be.equal(new BN(0).toString());
		expect(referrerFee.toString(), "Token bonus rewards is not matched").to.be.equal(submittedTokenBonusAmount.toString());

		checkSovBonusAmountPaid = new BN(submittedAffiliatesReward).add(new BN(previousAffiliateRewardsHeld));
		expect(checkSovBonusAmountPaid.toString(), "Affiliates bonus rewards paid is not matched").to.be.equal(
			sovBonusAmountPaid.toString()
		);

		checkedValueShouldBe = new BN(affiliateRewardsHeld).add(new BN(previousAffiliateRewardsHeld));
		expect(checkedValueShouldBe.toString(), "Affiliates bonus rewards is not matched").to.be.equal(
			submittedAffiliatesReward.toString()
		);

		// Check lockedSOV Balance of the referrer
		referrerBalanceInLockedSOV = await lockedSOV.getLockedBalance(referrer);
		expect(referrerBalanceInLockedSOV.toString(), "Referrer balance in lockedSOV is not matched").to.be.equal(
			checkSovBonusAmountPaid.toString()
		);

		// Do withdrawal
		let referrerTokenBalance = await doc.balanceOf(referrer);
		let referrerFee2 = new BN(referrerFee).add(new BN(submittedTokenBonusAmount));
		tx = await sovryn.withdrawAllAffiliatesReferrerTokenFees(referrer, { from: referrer });
		const referrerFeeAfterWithdrawal = await sovryn.affiliatesReferrerBalances(referrer, doc.address);
		let referrerTokenBalanceAfterWithdrawal = await doc.balanceOf(referrer);
		expect(referrerFeeAfterWithdrawal, "Incorrect all balance after all DoC withdraw").to.be.bignumber.equal(new BN(0));
		expect(referrerTokenBalanceAfterWithdrawal.sub(referrerTokenBalance).toString()).to.be.equal(referrerFee2.toString());

		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "WithdrawAffiliatesReferrerTokenFees", {
			referrer: referrer,
			receiver: referrer,
			tokenAddress: doc.address,
			amount: referrerFee2.toString(),
		});
	});

	it("Should revert if wrBTC price feed is set to v1 pool oracle", async () => {
		feeds = await PriceFeeds.new(testWrbtc.address, tokenSOV.address, doc.address);
		testToken1 = await TestToken.new("test token 1", "TEST1", 18, wei("20000", "ether"));

		// Set tetToken1 feed - price 2 BTC
		// Set v1 convert mockup
		liquidityV1ConverterMockupTestToken1 = await LiquidityPoolV1ConverterMockup.new(testToken1.address, testWrbtc.address);

		priceFeedsV1PoolOracleMockupTestToken1 = await deployMockContract(senderMock, IV1PoolOracle.abi);
		await priceFeedsV1PoolOracleMockupTestToken1.mock.latestAnswer.returns(wei("1", "ether"));
		await priceFeedsV1PoolOracleMockupTestToken1.mock.liquidityPool.returns(liquidityV1ConverterMockupTestToken1.address);

		priceFeedsV1PoolOracleTestToken1 = await PriceFeedV1PoolOracle.new(
			priceFeedsV1PoolOracleMockupTestToken1.address,
			testWrbtc.address,
			doc.address
		);

		// // Set rBTC feed - using rsk oracle
		// priceFeedsV1PoolOracleMockupBTC = await PriceFeedRSKOracleMockup.new();
		// await priceFeedsV1PoolOracleMockupBTC.setValue(wei("9", "ether"));
		// priceFeedsV1PoolOracleBTC = await PriceFeedRSKOracle.new(priceFeedsV1PoolOracleMockupBTC.address)

		// Set rBTC feed - using v1pool oracle
		liquidityV1ConverterMockupBTC = await LiquidityPoolV1ConverterMockup.new(testWrbtc.address, testWrbtc.address);

		priceFeedsV1PoolOracleMockupBTC = await deployMockContract(senderMock, IV1PoolOracle.abi);
		await priceFeedsV1PoolOracleMockupBTC.mock.latestAnswer.returns(wei("8", "ether"));
		await priceFeedsV1PoolOracleMockupBTC.mock.liquidityPool.returns(liquidityV1ConverterMockupBTC.address);

		priceFeedsV1PoolOracleBTC = await PriceFeedV1PoolOracle.new(
			priceFeedsV1PoolOracleMockupBTC.address,
			testWrbtc.address,
			doc.address
		);

		// Set DOC feed -- price 1 BTC
		liquidityV1ConverterMockupDOC = await LiquidityPoolV1ConverterMockup.new(doc.address, testWrbtc.address);
		
		priceFeedsV1PoolOracleMockupDOC = await deployMockContract(senderMock, IV1PoolOracle.abi);
		await priceFeedsV1PoolOracleMockupDOC.mock.latestAnswer.returns(wei("7", "ether"));
		await priceFeedsV1PoolOracleMockupDOC.mock.liquidityPool.returns(liquidityV1ConverterMockupDOC.address);

		priceFeedsV1PoolOracleDOC = await PriceFeedV1PoolOracle.new(
			priceFeedsV1PoolOracleMockupDOC.address,
			testWrbtc.address,
			doc.address
		);

		// await feeds.setPriceFeed([testWrbtc.address, doc.address], [priceFeedsV1PoolOracle.address, priceFeedsV1PoolOracle.address])
		await feeds.setPriceFeed(
			[testToken1.address, doc.address, testWrbtc.address],
			[priceFeedsV1PoolOracleTestToken1.address, priceFeedsV1PoolOracleDOC.address, priceFeedsV1PoolOracleBTC.address]
		);

		await expectRevert(feeds.queryRate(testToken1.address, doc.address), "wrBTC price feed cannot use the oracle v1 pool");
		await expectRevert(
			feeds.queryReturn(testToken1.address, doc.address, wei("1", "ether")),
			"wrBTC price feed cannot use the oracle v1 pool"
		);
	});
});
