const { expect } = require("chai");

const TestToken = artifacts.require("TestToken");
const TestWrbtc = artifacts.require("TestWrbtc");

const sovrynProtocol = artifacts.require("sovrynProtocol");
const ProtocolSettings = artifacts.require("ProtocolSettings");
const ISovryn = artifacts.require("ISovryn");

const LoanToken = artifacts.require("LoanToken");
const LoanTokenLogicStandard = artifacts.require("LoanTokenLogicStandard");
const LoanSettings = artifacts.require("LoanSettings");
const LoanMaintenance = artifacts.require("LoanMaintenance");
const LoanOpenings = artifacts.require("LoanOpenings");
const LoanClosingsBase = artifacts.require("LoanClosingsBase");
const LoanClosingsWith = artifacts.require("LoanClosingsWith");
const SwapsExternal = artifacts.require("SwapsExternal");

const PriceFeedsLocal = artifacts.require("PriceFeedsLocal");
const TestSovrynSwap = artifacts.require("TestSovrynSwap");
const SwapsImplSovrynSwap = artifacts.require("SwapsImplSovrynSwap");

const Affiliates = artifacts.require("Affiliates");

const TOTAL_SUPPLY = web3.utils.toWei("1000", "ether");

const { lend_to_the_pool, cash_out_from_the_pool, cash_out_from_the_pool_uint256_max_should_withdraw_total_balance } = require("./helpers");

const wei = web3.utils.toWei;

contract("LoanTokenLending", (accounts) => {
	const name = "Test token";
	const symbol = "TST";

	let lender, account1, account2, account3, account4;
	let underlyingToken, rBTC;
	let sovryn, loanToken;

	before(async () => {
		[lender, account1, account2, account3, account4, ...accounts] = accounts;
	});

	beforeEach(async () => {
		//Token
		underlyingToken = await TestToken.new(name, symbol, 18, TOTAL_SUPPLY);

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

		rBTC = await TestToken.new("RBTC", "RBTC", 18, wei("1000", "ether"));
		await sovryn.setWrbtcToken(rBTC.address);

		feeds = await PriceFeedsLocal.new(rBTC.address, sovryn.address);
		await feeds.setRates(underlyingToken.address, rBTC.address, wei("0.01", "ether"));
		const swaps = await SwapsImplSovrynSwap.new();
		const sovrynSwapSimulator = await TestSovrynSwap.new(feeds.address);
		await sovryn.setSovrynSwapContractRegistryAddress(sovrynSwapSimulator.address);
		await sovryn.setSupportedTokens([underlyingToken.address, rBTC.address], [true, true]);
		await sovryn.setPriceFeedContract(
			feeds.address //priceFeeds
		);
		await sovryn.setSwapsImplContract(
			swaps.address // swapsImpl
		);
		await sovryn.setFeesController(lender);

		loanTokenLogicStandard = await LoanTokenLogicStandard.new();
		loanToken = await LoanToken.new(lender, loanTokenLogicStandard.address, sovryn.address, rBTC.address);
		await loanToken.initialize(underlyingToken.address, name, symbol); //iToken
		loanToken = await LoanTokenLogicStandard.at(loanToken.address);

		params = [
			"0x0000000000000000000000000000000000000000000000000000000000000000", // bytes32 id; // id of loan params object
			false, // bool active; // if false, this object has been disabled by the owner and can't be used for future loans
			lender, // address owner; // owner of this object
			underlyingToken.address, // address loanToken; // the token being loaned
			rBTC.address, // address collateralToken; // the required collateral token
			wei("20", "ether"), // uint256 minInitialMargin; // the minimum allowed initial margin
			wei("15", "ether"), // uint256 maintenanceMargin; // an unhealthy loan when current margin is at or below this value
			2419200, // uint256 maxLoanTerm; // the maximum term for new loans (0 means there's no max term)
		];

		await loanToken.setupLoanParams([params], false);

		const loanTokenAddress = await loanToken.loanTokenAddress();
		if (lender == (await sovryn.owner())) await sovryn.setLoanPool([loanToken.address], [loanTokenAddress]);

		// const baseRate = wei("1", "ether");
		// const rateMultiplier = wei("20.25", "ether");
		// const targetLevel = wei("80", "ether");
		// const kinkLevel = wei("90", "ether");
		// const maxScaleRate = wei("100", "ether");
		// await loanToken.setDemandCurve(baseRate, rateMultiplier, baseRate, rateMultiplier, targetLevel, kinkLevel, maxScaleRate);

		await rBTC.mint(sovryn.address, wei("500", "ether"));
	});

	describe("test lending using wRBTC as collateral", () => {
		it("test lend to the pool", async () => {
			await lend_to_the_pool(loanToken, lender, underlyingToken, rBTC, sovryn);
		});

		it("test cash out from the pool", async () => {
			await cash_out_from_the_pool(loanToken, lender, underlyingToken, false);
		});

		it("test cash out from the pool more of lender balance should not fail", async () => {
			//await cash_out_from_the_pool_more_of_lender_balance_should_not_fail(loanToken, lender, underlyingToken);
			await cash_out_from_the_pool_uint256_max_should_withdraw_total_balance(loanToken, lender, underlyingToken);
		});
	});
});
