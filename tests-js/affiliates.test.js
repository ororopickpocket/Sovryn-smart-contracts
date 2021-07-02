const { assert } = require("chai");
// const LoanTokenLogicStandard = artifacts.require("LoanTokenLogicStandard"); //replaced by MockLoanTokenLogic
const sovrynProtocol = artifacts.require("sovrynProtocol");
const LoanToken = artifacts.require("LoanToken");
const MockLoanTokenLogic = artifacts.require("MockLoanTokenLogic"); //added functionality for isolated unit testing
const LockedSOVFailedMockup = artifacts.require("LockedSOVFailedMockup");
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
const TestSovrynSwap = artifacts.require("TestSovrynSwap");
const SwapsImplSovrynSwap = artifacts.require("SwapsImplSovrynSwap");
const Affiliates = artifacts.require("Affiliates");

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
	before(async () => {
		[owner, trader, referrer, account1, account2, ...accounts] = accounts;
	});
	beforeEach(async () => {
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

		//loanTokenLogic = await LoanTokenLogicStandard.new();
		loanTokenLogic = await MockLoanTokenLogic.new();
		testWrbtc = await TestWrbtc.new();
		doc = await TestToken.new("dollar on chain", "DOC", 18, wei("20000", "ether"));
		tokenSOV = await SOV.new(TOTAL_SUPPLY);
		loanToken = await LoanToken.new(owner, loanTokenLogic.address, sovryn.address, testWrbtc.address);
		await loanToken.initialize(doc.address, "SUSD", "SUSD");

		// loanTokenV2 = await LoanTokenLogicStandard.at(loanToken.address);
		loanTokenV2 = await MockLoanTokenLogic.at(loanToken.address); //mocked for ad-hoc logic for isolated testing
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

	it("Should not be able to set the affiliateFeePercent more than 100%", async () => {
		const valueExperiment = wei("101", "ether");
		await expectRevert(sovryn.setAffiliateFeePercent(0, { from: referrer }), "unauthorized");
		await expectRevert(sovryn.setAffiliateFeePercent(valueExperiment), "value too high");
	});

	it("User Margin Trade with Affiliate runs correctly", async () => {
		//expected in x * 10**18 where x is the actual leverage (2, 3, 4, or 5)
		const leverageAmount = web3.utils.toWei("3", "ether");
		//loan tokens sent to iToken contract to start Margin Trading
		const loanTokenSent = web3.utils.toWei("20", "ether");
		// AUDIT: should the call be allowed from arbitrary address to set an affiliate in
		// LoanTokenLogicStandard.marginTradeAffiliate?
		const tx = await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // leverageAmount
			loanTokenSent, // loanTokenSent
			0, // no collateral token sent
			testWrbtc.address, // collateralTokenAddress
			trader,
			0, // max slippage
			referrer, // affiliates referrer
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);

		expect(await sovryn.getUserNotFirstTradeFlag(trader), "userNotFirstTradeFlag has not been set to true").to.be.true;
		expect(await sovryn.getAffiliatesUserReferrer(trader), "Incorrect User Affiliate Referrer set").to.be.equal(referrer);

		let event_name = "PayTradingFeeToAffiliate";
		let decode = decodeLogs(tx.receipt.rawLogs, Affiliates, event_name);
		const referrerFee = await sovryn.affiliatesReferrerBalances(referrer, doc.address);
		if (!decode.length) {
			throw "Event PayTradingFeeToAffiliate is not fired properly";
		}

		tradingFeeAmount = decode[0].args["tradingFeeTokenAmount"];
		submittedToken = decode[0].args["token"];
		submittedReferrer = decode[0].args["referrer"];
		submittedTrader = decode[0].args["trader"];
		isHeld = decode[0].args["isHeld"];
		affiliatesFeePercentage = await sovryn.affiliateFeePercent();
		sovBonusAmountShouldBePaid = await feeds.queryReturn(
			doc.address,
			tokenSOV.address,
			((affiliatesFeePercentage * tradingFeeAmount) / Math.pow(10, 20)).toString()
		);
		submittedSovBonusAmount = decode[0].args["sovBonusAmount"];
		submittedTokenBonusAmount = decode[0].args["tokenBonusAmount"];
		affiliateRewardsHeld = await sovryn.getAffiliateRewardsHeld(referrer);
		expect(sovBonusAmountShouldBePaid.toString(), "Incorrect sov bonus amount calculation").to.be.equal(submittedSovBonusAmount);
		expect(submittedToken).to.eql(doc.address);
		expect(submittedReferrer).to.eql(referrer);
		expect(submittedTrader).to.eql(trader);
		expect(referrerFee.toString()).to.be.equal(submittedTokenBonusAmount.toString());
		// Since the minimum referrals to payout is set to 3, make sure the affiliateRewardsHeld is correct
		expect(affiliateRewardsHeld.toString(), "SOV Bonus amount that stored in the affiliateRewardsHeld is incorrect").to.be.equal(
			sovBonusAmountShouldBePaid.toString()
		);
		expect(isHeld, "Token should not be sent since the minimum referrals to payout has not been fullfilled").to.eql(true);

		lockedSOVBalance = await lockedSOV.getLockedBalance(referrer);
		expect(lockedSOVBalance.toString(), "Locked sov balance should be 0").to.eql(new BN(0).toString());

		/*----------------------------------- Do a trade once again, and set the min referrals to payout to 1 -----------------------------------*/
		previousAffiliateRewardsHeld = affiliateRewardsHeld;
		await sovryn.setMinReferralsToPayoutAffiliates(1);
		const tx2 = await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // leverageAmount
			loanTokenSent, // loanTokenSent
			0, // no collateral token sent
			testWrbtc.address, // collateralTokenAddress
			trader,
			0, // max slippage
			referrer, // affiliates referrer
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);

		decode = decodeLogs(tx2.receipt.rawLogs, Affiliates, event_name);
		if (!decode.length) {
			throw "Event PayTradingFeeToAffiliate is not fired properly";
		}

		// At this point, the remaining affiliate rewards in protocol + current rewards will be sent to the locked sov
		tradingFeeAmount = decode[0].args["tradingFeeTokenAmount"];
		submittedToken = decode[0].args["token"];
		submittedReferrer = decode[0].args["referrer"];
		submittedTrader = decode[0].args["trader"];
		isHeld = decode[0].args["isHeld"];
		sovBonusAmountShouldBePaid = await feeds.queryReturn(
			doc.address,
			tokenSOV.address,
			((affiliatesFeePercentage * tradingFeeAmount) / Math.pow(10, 20)).toString()
		);
		submittedSovBonusAmount = decode[0].args["sovBonusAmount"];
		paidSovBonusAmount = decode[0].args["sovBonusAmountPaid"];
		affiliateRewardsHeld = await sovryn.getAffiliateRewardsHeld(referrer);

		expect(sovBonusAmountShouldBePaid.toString(), "Incorrect sov bonus amount calculation").to.be.equal(
			submittedSovBonusAmount.toString()
		);
		expect(submittedToken).to.eql(doc.address);
		expect(submittedReferrer).to.eql(referrer);
		expect(submittedTrader).to.eql(trader);

		expect(
			new BN(parseInt(previousAffiliateRewardsHeld)).add(new BN(parseInt(sovBonusAmountShouldBePaid))).toString(),
			"Incorrect sov bonus amount calculation"
		).to.be.equal(paidSovBonusAmount.toString());
		expect(affiliateRewardsHeld.toString(), "Affiliates rewards should be 0 after rewards is sent").to.eql(new BN(0).toString());
		expect(isHeld, "Token should be sent since the minimum referrals to payout has not been fullfilled").to.eql(false);

		lockedSOVBalance = await lockedSOV.getLockedBalance(referrer);
		expect(lockedSOVBalance.toString(), "Locked sov balance should be 0").to.eql(paidSovBonusAmount.toString());
	});

	it("User Margin Trade with Affiliate runs correctly when  minimum referrals set to 1", async () => {
		await sovryn.setMinReferralsToPayoutAffiliates(1);
		//expected in x * 10**18 where x is the actual leverage (2, 3, 4, or 5)
		const leverageAmount = web3.utils.toWei("3", "ether");
		//loan tokens sent to iToken contract to start Margin Trading
		const loanTokenSent = web3.utils.toWei("20", "ether");
		// AUDIT: should the call be allowed from arbitrary address to set an affiliate in
		// LoanTokenLogicStandard.marginTradeAffiliate?
		const tx = await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // leverageAmount
			loanTokenSent, // loanTokenSent
			0, // no collateral token sent
			testWrbtc.address, // collateralTokenAddress
			trader,
			0, // max slippage
			referrer, // affiliates referrer
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);

		expect(await sovryn.getUserNotFirstTradeFlag(trader), "userNotFirstTradeFlag has not been set to true").to.be.true;
		expect(await sovryn.getAffiliatesUserReferrer(trader), "Incorrect User Affiliate Referrer set").to.be.equal(referrer);

		const event_name = "PayTradingFeeToAffiliate";
		const decode = decodeLogs(tx.receipt.rawLogs, Affiliates, event_name);
		const referrerFee = await sovryn.affiliatesReferrerBalances(referrer, doc.address);
		if (!decode.length) {
			throw "Event PayTradingFeeToAffiliate is not fired properly";
		}

		tradingFeeAmount = decode[0].args["tradingFeeTokenAmount"];
		submittedToken = decode[0].args["token"];
		submittedReferrer = decode[0].args["referrer"];
		submittedTrader = decode[0].args["trader"];
		isHeld = decode[0].args["isHeld"];
		affiliatesFeePercentage = await sovryn.affiliateFeePercent();
		sovBonusAmountShouldBePaid = await feeds.queryReturn(
			doc.address,
			tokenSOV.address,
			((affiliatesFeePercentage * tradingFeeAmount) / Math.pow(10, 20)).toString()
		);
		submittedSovBonusAmount = decode[0].args["sovBonusAmountPaid"];
		submittedTokenBonusAmount = decode[0].args["tokenBonusAmount"];
		affiliateRewardsHeld = await sovryn.getAffiliateRewardsHeld(referrer);
		expect(sovBonusAmountShouldBePaid.toString(), "Incorrect sov bonus amount calculation").to.be.equal(submittedSovBonusAmount);
		expect(submittedToken).to.eql(doc.address);
		expect(submittedReferrer).to.eql(referrer);
		expect(submittedTrader).to.eql(trader);
		expect(referrerFee.toString()).to.be.equal(submittedTokenBonusAmount.toString());
		// Since the minimum referrals to payout is set to 1, make sure the affiliateRewardsHeld is correct
		expect(affiliateRewardsHeld.toString(), "SOV Bonus amount that stored in the affiliateRewardsHeld is incorrect").to.be.equal(
			new BN(0).toString()
		);
		expect(isHeld, "Token should be sent since the minimum referrals to payout has not been fullfilled").to.eql(false);

		lockedSOVBalance = await lockedSOV.getLockedBalance(referrer);
		expect(lockedSOVBalance.toString(), "Locked sov balance is not matched").to.eql(sovBonusAmountShouldBePaid.toString());
	});

	it("PayTradingFeeToAffiliateFail event should be fired in case lock sov reverted", async () => {
		// deploy lockedSOVFailedMockup and set to protocol
		await sovryn.setLockedSOVAddress((await LockedSOVFailedMockup.new(tokenSOV.address, [owner])).address);

		await sovryn.setMinReferralsToPayoutAffiliates(1);
		//expected in x * 10**18 where x is the actual leverage (2, 3, 4, or 5)
		const leverageAmount = web3.utils.toWei("3", "ether");
		//loan tokens sent to iToken contract to start Margin Trading
		const loanTokenSent = web3.utils.toWei("20", "ether");
		// AUDIT: should the call be allowed from arbitrary address to set an affiliate in
		// LoanTokenLogicStandard.marginTradeAffiliate?
		const tx = await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // leverageAmount
			loanTokenSent, // loanTokenSent
			0, // no collateral token sent
			testWrbtc.address, // collateralTokenAddress
			trader,
			0, // max slippage
			referrer, // affiliates referrer
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);

		const event_failed_name = "PayTradingFeeToAffiliateFail";
		const decodeFailed = decodeLogs(tx.receipt.rawLogs, Affiliates, event_failed_name);
		if (!decodeFailed.length) {
			throw "Event PayTradingFeeToAffiliateFail is not fired properly";
		}

		// We need to make sure that the fail log event is fired
		tradingFeeAmount = decodeFailed[0].args["tradingFeeTokenAmount"];
		submittedToken = decodeFailed[0].args["token"];
		submittedReferrer = decodeFailed[0].args["referrer"];
		submittedTrader = decodeFailed[0].args["trader"];
		sovBonusAmount = decodeFailed[0].args["sovBonusAmount"];
		affiliatesFeePercentage = await sovryn.affiliateFeePercent();
		sovBonusAmountShouldBePaid = await feeds.queryReturn(
			doc.address,
			tokenSOV.address,
			((affiliatesFeePercentage * tradingFeeAmount) / Math.pow(10, 20)).toString()
		);
		expect(await sovryn.getUserNotFirstTradeFlag(trader), "userNotFirstTradeFlag has not been set to true").to.be.true;
		expect(await sovryn.getAffiliatesUserReferrer(trader), "Incorrect User Affiliate Referrer set").to.be.equal(referrer);
		expect(sovBonusAmountShouldBePaid.toString(), "Incorrect sov bonus amount calculation").to.be.equal(sovBonusAmount);
		expect(submittedToken).to.eql(doc.address);
		expect(submittedReferrer).to.eql(referrer);
		expect(submittedTrader).to.eql(trader);
	});

	it("Only the first trade users can be assigned Affiliates Referrer", async () => {
		let tx = await loanTokenV2.setUserNotFirstTradeFlag(trader); // can be called only from loan tokens pool addresses
		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "SetUserNotFirstTradeFlag", {
			user: trader,
		});
		tx = await loanTokenV2.setAffiliatesReferrer(trader, referrer); // can be called only from loan tokens pool addresses
		expect(await sovryn.getAffiliatesUserReferrer(trader), "Referrer cannot be set for non first trade users").to.be.equal(
			constants.ZERO_ADDRESS
		);

		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "SetAffiliatesReferrerFail", {
			user: trader,
			referrer: referrer,
		});
	});

	it("Affiliates Referrer cannot be changed once set", async () => {
		const tx = await loanTokenV2.setAffiliatesReferrer(trader, referrer); // can be called only from loan tokens pool addresses
		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "SetAffiliatesReferrer", {
			user: trader,
			referrer: referrer,
		});
		await loanTokenV2.setAffiliatesReferrer(trader, account1); // try to replace referrer
		expect(await sovryn.getAffiliatesUserReferrer(trader), "Affiliates Referrer is set once and cannot be changed").to.be.equal(
			referrer
		);
	});

	it("Users cannot be self-referrers", async () => {
		// try to replace referrer
		await loanTokenV2.setAffiliatesReferrer(trader, trader); // can be called only from loan tokens pool addresses
		expect(await sovryn.getAffiliatesUserReferrer(trader), "Affiliates Referrer is set once and cannot be changed").to.be.equal(
			constants.ZERO_ADDRESS
		);
	});

	it("First users Margin trading without affiliate referrer sets userNotFirstTradingFlag = true", async () => {
		const leverageAmount = web3.utils.toWei("3", "ether");
		const loanTokenSent = web3.utils.toWei("20", "ether");
		await loanTokenV2.marginTrade(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // leverageAmount
			loanTokenSent, // loanTokenSent
			0, // no collateral token sent
			testWrbtc.address, // collateralTokenAddress
			trader, // trader,
			0, // max slippage
			//referrer, // affiliates referrer
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);
		expect(await sovryn.getUserNotFirstTradeFlag(trader), "sovryn.getUserNotFirstTradeFlag(trader) should be true").to.be.true;
	});

	it("Doesn't allow fallback function calls", async () => {
		const affiliates = await Affiliates.new();
		await expectRevert(
			affiliates.send(wei("0.0000000000000001", "ether")),
			"fallback function is not payable and was called with value 100"
		);
		await expectRevert(affiliates.sendTransaction({}), "Affiliates - fallback not allowed");
	});

	it("payTradingFeeToAffiliatesReferrer() Should revert if not called by protocol", async () => {
		await expectRevert(
			sovryn.payTradingFeeToAffiliatesReferrer(referrer, trader, tokenSOV.address, wei("1", "gwei")),
			"Affiliates: not authorized"
		);
	});

	it("setAffiliatesReferrer() should revert if not called by loanPool", async () => {
		await expectRevert(sovryn.setAffiliatesReferrer(accounts[0], referrer), "Affiliates: not authorized");
	});

	it("setUserNotFirstTradeFlag() should revert if not called by loanPool", async () => {
		await expectRevert(sovryn.setUserNotFirstTradeFlag(referrer), "Affiliates: not authorized");
	});

	it("Test referralList when set Affiliates referrer", async () => {
		let tx = await loanTokenV2.setAffiliatesReferrer(trader, referrer); // can be called only from loan tokens pool addresses
		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "SetAffiliatesReferrer", {
			user: trader,
			referrer: referrer,
		});
		let refList = await sovryn.getReferralsList(referrer);
		expect(refList[0], "Referrals list is not matched").to.be.equal(trader);

		tx = await loanTokenV2.setAffiliatesReferrer(accounts[9], referrer);
		refList = await sovryn.getReferralsList(referrer);
		expect(refList.length).to.be.equal(2);
	});

	it("Test referralList won't be duplicate when set Affiliates referrer twice", async () => {
		let tx = await loanTokenV2.setAffiliatesReferrer(trader, referrer); // can be called only from loan tokens pool addresses
		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "SetAffiliatesReferrer", {
			user: trader,
			referrer: referrer,
		});
		let refList = await sovryn.getReferralsList(referrer);
		expect(refList[0], "Referrals list is not matched").to.be.equal(trader);

		tx = await loanTokenV2.setAffiliatesReferrer(trader, referrer); // can be called only from loan tokens pool addresses
		refList = await sovryn.getReferralsList(referrer);
		expect(refList.length).to.be.equal(1);
	});

	it("Withdraw all token will revert if receiver is zero address", async () => {
		await expectRevert(
			sovryn.withdrawAllAffiliatesReferrerTokenFees(constants.ZERO_ADDRESS, { from: referrer }),
			"Affiliates: cannot withdraw to zero address"
		);
	});

	it("Withdraw all token will revert if minimum affiliates to payout is not fulfilled", async () => {
		await expectRevert(
			sovryn.withdrawAllAffiliatesReferrerTokenFees(referrer, { from: referrer }),
			"Your referrals has not reached the minimum request"
		);
	});

	it("Affiliates referrer withdraw fees should revert because of the minimum request is not fullfilled", async () => {
		const leverageAmount = web3.utils.toWei("3", "ether");
		//loan tokens sent to iToken contract to start Margin Trading
		const loanTokenSent = web3.utils.toWei("20", "ether");
		// AUDIT: should the call be allowed from arbitrary address to set an affiliate in
		// LoanTokenLogicStandard.marginTradeAffiliate?
		const tx = await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // leverageAmount
			loanTokenSent, // loanTokenSent
			0, // no collateral token sent
			testWrbtc.address, // collateralTokenAddress
			trader,
			0, // max slippage
			referrer, // affiliates referrer
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);

		//WITHDRAW AFFILIATE FEES
		//FAIL
		const referrerFee = await sovryn.affiliatesReferrerBalances(referrer, doc.address);
		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(doc.address, constants.ZERO_ADDRESS, referrerFee, { from: referrer }),
			"Affiliates: cannot withdraw to zero address"
		);
		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(doc.address, referrer, 0, { from: referrer }),
			"Affiliates: cannot withdraw zero amount"
		);

		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(doc.address, referrer, referrerFee, { from: referrer }),
			"Your referrals has not reached the minimum request"
		);
	});

	it("Affiliates Referrer withdraw fees in two tokens works correctly with min referrals to payout is 0", async () => {
		await sovryn.setMinReferralsToPayoutAffiliates(1);
		const leverageAmount = web3.utils.toWei("3", "ether");
		//loan tokens sent to iToken contract to start Margin Trading
		const loanTokenSent = web3.utils.toWei("20", "ether");

		const leverageAmount2 = web3.utils.toWei("3", "ether");
		//loan tokens sent to iToken contract to start Margin Trading
		const loanTokenSent2 = web3.utils.toWei("20", "ether");

		//add another pair
		//loanTokenLogic = await MockLoanTokenLogic.new();
		//testWrbtc = await TestWrbtc.new();
		eur = await TestToken.new("euro on chain 2", "EUR", 18, wei("20000", "ether"));
		const loanToken2 = await LoanToken.new(owner, loanTokenLogic.address, sovryn.address, testWrbtc.address);
		await loanToken2.initialize(eur.address, "SEUR", "SEUR");

		// loanTokenV2 = await LoanTokenLogicStandard.at(loanToken.address);
		loanToken2V2 = await MockLoanTokenLogic.at(loanToken2.address); //mocked for ad-hoc logic for isolated testing
		const loanTokenAddress2 = await loanToken2.loanTokenAddress();
		if (owner == (await sovryn.owner())) {
			await sovryn.setLoanPool([loanToken2V2.address], [loanTokenAddress2]);
		}
		await feeds.setRates(eur.address, testWrbtc.address, wei("0.01", "ether"));
		await sovryn.setSupportedTokens([eur.address], [true]);

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
			eur.address, // address loanToken; // the token being loaned
			testWrbtc.address, // address collateralToken; // the required collateral token
			wei("20", "ether"), // uint256 minInitialMargin; // the minimum allowed initial margin
			wei("15", "ether"), // uint256 maintenanceMargin; // an unhealthy loan when current margin is at or below this value
			2419200, // uint256 maxLoanTerm; // the maximum term for new loans (0 means there's no max term)
		];

		//await loanTokenV2.setupLoanParams([params], true);
		await loanToken2V2.setupLoanParams([params], false);

		// setting up interest rates
		const baseRate = wei("1", "ether");
		const rateMultiplier = wei("20.25", "ether");
		const targetLevel = wei("80", "ether");
		const kinkLevel = wei("90", "ether");
		const maxScaleRate = wei("100", "ether");
		await loanToken2V2.setDemandCurve(baseRate, rateMultiplier, baseRate, rateMultiplier, targetLevel, kinkLevel, maxScaleRate);

		// GIVING SOME DOC tokens to loanToken so that we can borrow from loanToken
		await eur.transfer(loanToken2V2.address, wei("500", "ether"));
		await eur.transfer(trader, wei("20", "ether"));
		//trader approves to LoanToken loan amount for trading
		await eur.approve(loanToken2.address, web3.utils.toWei("20", "ether"), { from: trader });
		//Giving some more testRbtc to sovrynAddress (by minting some testRbtc),so that it can open position in wRBTC.
		await testWrbtc.mint(sovryn.address, wei("500", "ether"));

		//margin trade afiliate 2 tokens
		await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // leverageAmount
			loanTokenSent, // loanTokenSent
			0, // no collateral token sent
			testWrbtc.address, // collateralTokenAddress
			trader,
			0, // max slippage
			referrer, // affiliates referrer
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);
		const referrerFee = await sovryn.affiliatesReferrerBalances(referrer, doc.address);

		await loanToken2V2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount2, // leverageAmount
			loanTokenSent2, // loanTokenSent
			0, // no collateral token sent
			testWrbtc.address, // collateralTokenAddress
			trader,
			0, // max slippage
			referrer, // affiliates referrer
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);
		const referrerFee2 = await sovryn.affiliatesReferrerBalances(referrer, eur.address);

		//WITHDRAW AFFILIATE FEES
		//FAIL
		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(doc.address, constants.ZERO_ADDRESS, referrerFee, { from: referrer }),
			"Affiliates: cannot withdraw to zero address"
		);
		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(eur.address, constants.ZERO_ADDRESS, referrerFee2, { from: referrer }),
			"Affiliates: cannot withdraw to zero address"
		);
		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(doc.address, referrer, 0, { from: referrer }),
			"Affiliates: cannot withdraw zero amount"
		);
		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(eur.address, referrer, 0, { from: referrer }),
			"Affiliates: cannot withdraw zero amount"
		);

		//SUCCESS
		//partial withdraw
		let tx;
		tx = await sovryn.withdrawAffiliatesReferrerTokenFees(doc.address, referrer, referrerFee.divn(2), { from: referrer });
		const newReferrerFee = await sovryn.affiliatesReferrerBalances(referrer, doc.address);
		expect(newReferrerFee, "Incorrect partial balance after half DoC withdraw").to.be.bignumber.equal(referrerFee.divn(2));

		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "WithdrawAffiliatesReferrerTokenFees", {
			referrer: referrer,
			receiver: referrer,
			tokenAddress: doc.address,
			amount: referrerFee.divn(2).toString(),
		});

		await sovryn.withdrawAffiliatesReferrerTokenFees(eur.address, referrer, referrerFee2.divn(4), { from: referrer });
		const newReferrerFee2 = await sovryn.affiliatesReferrerBalances(referrer, eur.address);

		expect(newReferrerFee2, "Incorrect partial balance after a quarter EUR withdraw").to.be.bignumber.equal(
			referrerFee2.muln(3).divn(4)
		);

		let refBalances = await sovryn.getAffiliatesReferrerBalances(referrer);

		//complete withdraw
		await sovryn.withdrawAffiliatesReferrerTokenFees(doc.address, referrer, newReferrerFee, { from: referrer });
		expect(await doc.balanceOf(referrer), "Incorrect DoC withdraw amount").to.be.bignumber.equal(referrerFee);
		expect(
			await sovryn.affiliatesReferrerBalances(referrer, doc.address),
			"Affiliate Referrer's balance of DoC should be zero after withdrawal"
		).to.be.bignumber.equal(new BN(0));

		// now the DoC token and it's balance for the referrer should be removed from the list
		refBalances = await sovryn.getAffiliatesReferrerBalances(referrer);
		expect(refBalances["referrerTokensList"][0]).to.eql(eur.address);
		expect(refBalances["referrerTokensList"]).to.have.length(1);
		expect(refBalances["referrerTokensBalances"][0]).to.be.bignumber.equal(new BN(Math.pow(10, 15)).muln(18));
		expect(refBalances["referrerTokensBalances"]).to.have.length(1);

		await sovryn.withdrawAffiliatesReferrerTokenFees(eur.address, referrer, newReferrerFee2, { from: referrer });
		expect(await eur.balanceOf(referrer), "Incorrect EUR withdraw amount").to.be.bignumber.equal(referrerFee2);
		expect(
			await sovryn.affiliatesReferrerBalances(referrer, eur.address),
			"Affiliate Referrer's balance of EUR should be zero after withdrawal"
		).to.be.bignumber.equal(new BN(0));

		refBalances = await sovryn.getAffiliatesReferrerBalances(referrer);
		expect(refBalances["referrerTokensList"][0], "After withdrawal the token should be deleted from the referrers list").to.be
			.undefined;
		expect(refBalances["referrerTokensBalances"][0], "After withdrawal the token balances should be deleted from the referrers list").to
			.be.undefined;
	});

	it("Affiliates Referrer withdraw all fees for two tokens works correctly with min referrals to payout is 0", async () => {
		await sovryn.setMinReferralsToPayoutAffiliates(1);
		const leverageAmount = web3.utils.toWei("3", "ether");
		//loan tokens sent to iToken contract to start Margin Trading
		const loanTokenSent = web3.utils.toWei("20", "ether");

		const leverageAmount2 = web3.utils.toWei("3", "ether");
		//loan tokens sent to iToken contract to start Margin Trading
		const loanTokenSent2 = web3.utils.toWei("10", "ether");

		//add another pair
		//loanTokenLogic = await MockLoanTokenLogic.new();
		//testWrbtc = await TestWrbtc.new();
		eur = await TestToken.new("euro on chain 2", "EUR", 18, wei("20000", "ether"));
		const loanToken2 = await LoanToken.new(owner, loanTokenLogic.address, sovryn.address, testWrbtc.address);
		await loanToken2.initialize(eur.address, "SEUR", "SEUR");

		// loanTokenV2 = await LoanTokenLogicStandard.at(loanToken.address);
		loanToken2V2 = await MockLoanTokenLogic.at(loanToken2.address); //mocked for ad-hoc logic for isolated testing
		const loanTokenAddress2 = await loanToken2.loanTokenAddress();
		if (owner == (await sovryn.owner())) {
			await sovryn.setLoanPool([loanToken2V2.address], [loanTokenAddress2]);
		}
		await feeds.setRates(eur.address, testWrbtc.address, wei("0.01", "ether"));
		await sovryn.setSupportedTokens([eur.address], [true]);

		params = [
			"0x0000000000000000000000000000000000000000000000000000000000000000", // bytes32 id; // id of loan params object
			false, // bool active; // if false, this object has been disabled by the owner and can't be used for future loans
			owner, // address owner; // owner of this object
			eur.address, // address loanToken; // the token being loaned
			testWrbtc.address, // address collateralToken; // the required collateral token
			wei("20", "ether"), // uint256 minInitialMargin; // the minimum allowed initial margin
			wei("15", "ether"), // uint256 maintenanceMargin; // an unhealthy loan when current margin is at or below this value
			2419200, // uint256 maxLoanTerm; // the maximum term for new loans (0 means there's no max term)
		];

		//await loanTokenV2.setupLoanParams([params], true);
		await loanToken2V2.setupLoanParams([params], false);

		// setting up interest rates
		const baseRate = wei("1", "ether");
		const rateMultiplier = wei("20.25", "ether");
		const targetLevel = wei("80", "ether");
		const kinkLevel = wei("90", "ether");
		const maxScaleRate = wei("100", "ether");
		await loanToken2V2.setDemandCurve(baseRate, rateMultiplier, baseRate, rateMultiplier, targetLevel, kinkLevel, maxScaleRate);

		// GIVING SOME DOC tokens to loanToken so that we can borrow from loanToken
		await eur.transfer(loanToken2V2.address, wei("500", "ether"));
		await eur.transfer(trader, wei("20", "ether"));
		//trader approves to LoanToken loan amount for trading
		await eur.approve(loanToken2.address, web3.utils.toWei("20", "ether"), { from: trader });
		//Giving some more testRbtc to sovrynAddress (by minting some testRbtc),so that it can open position in wRBTC.
		await testWrbtc.mint(sovryn.address, wei("500", "ether"));

		//margin trade afiliate 2 tokens
		await loanTokenV2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount, // leverageAmount
			loanTokenSent, // loanTokenSent
			0, // no collateral token sent
			testWrbtc.address, // collateralTokenAddress
			trader,
			0, // max slippage
			referrer, // affiliates referrer
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);
		const referrerFee = await sovryn.affiliatesReferrerBalances(referrer, doc.address);

		await loanToken2V2.marginTradeAffiliate(
			constants.ZERO_BYTES32, // loanId  (0 for new loans)
			leverageAmount2, // leverageAmount
			loanTokenSent2, // loanTokenSent
			0, // no collateral token sent
			testWrbtc.address, // collateralTokenAddress
			trader,
			0, // max slippage
			referrer, // affiliates referrer
			"0x", // loanDataBytes (only required with ether)
			{ from: trader }
		);
		const referrerFee2 = await sovryn.affiliatesReferrerBalances(referrer, eur.address);

		//WITHDRAW AFFILIATE FEES
		//FAIL
		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(doc.address, constants.ZERO_ADDRESS, referrerFee, { from: referrer }),
			"Affiliates: cannot withdraw to zero address"
		);
		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(eur.address, constants.ZERO_ADDRESS, referrerFee2, { from: referrer }),
			"Affiliates: cannot withdraw to zero address"
		);
		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(doc.address, referrer, 0, { from: referrer }),
			"Affiliates: cannot withdraw zero amount"
		);
		await expectRevert(
			sovryn.withdrawAffiliatesReferrerTokenFees(eur.address, referrer, 0, { from: referrer }),
			"Affiliates: cannot withdraw zero amount"
		);

		//SUCCESS
		//withdraw all
		let tx;
		tx = await sovryn.withdrawAllAffiliatesReferrerTokenFees(referrer, { from: referrer });
		const newReferrerFee = await sovryn.affiliatesReferrerBalances(referrer, doc.address);
		expect(newReferrerFee, "Incorrect all balance after all DoC withdraw").to.be.bignumber.equal(new BN(0));

		await expectEvent.inTransaction(tx.receipt.rawLogs[0].transactionHash, Affiliates, "WithdrawAffiliatesReferrerTokenFees", {
			referrer: referrer,
			receiver: referrer,
			tokenAddress: doc.address,
			amount: referrerFee.toString(),
		});

		const newReferrerFee2 = await sovryn.affiliatesReferrerBalances(referrer, eur.address);
		expect(newReferrerFee2, "Incorrect all balance after all EUR withdraw").to.be.bignumber.equal(new BN(0));

		await expectEvent.inTransaction(tx.receipt.rawLogs[1].transactionHash, Affiliates, "WithdrawAffiliatesReferrerTokenFees", {
			referrer: referrer,
			receiver: referrer,
			tokenAddress: eur.address,
			amount: referrerFee2.toString(),
		});

		let refBalances = await sovryn.getAffiliatesReferrerBalances(referrer);
		expect(refBalances["referrerTokensList"][0], "After withdrawal the token should be deleted from the referrers list").to.be
			.undefined;
		expect(refBalances["referrerTokensBalances"][0], "After withdrawal the token balances should be deleted from the referrers list").to
			.be.undefined;
	});
});
