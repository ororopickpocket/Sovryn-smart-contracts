const { expect } = require("chai");
const { expectRevert, BN, constants } = require("@openzeppelin/test-helpers");
const { increaseTime } = require("../Utils/Ethereum");

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

//const { lend_to_the_pool, cash_out_from_the_pool, cash_out_from_the_pool_more_of_lender_balance_should_not_fail } = require("./helpers");
const { lend_to_the_pool, cash_out_from_the_pool, cash_out_from_the_pool_uint256_max_should_withdraw_total_balance } = require("./helpers");

const wei = web3.utils.toWei;

contract("LoanTokenLending", (accounts) => {
	const name = "Test token";
	const symbol = "TST";

	let lender, account1, account2, account3, account4;
	let underlyingToken, testWrbtc;
	let sovryn, loanToken;

	before(async () => {
		[lender, account1, account2, account3, account4, ...accounts] = accounts;
	});

	beforeEach(async () => {
		//Token
		underlyingToken = await TestToken.new(name, symbol, 18, TOTAL_SUPPLY);
		testWrbtc = await TestWrbtc.new();

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

		await sovryn.setWrbtcToken(testWrbtc.address);

		feeds = await PriceFeedsLocal.new(testWrbtc.address, sovryn.address);
		await feeds.setRates(underlyingToken.address, testWrbtc.address, wei("0.01", "ether"));
		const swaps = await SwapsImplSovrynSwap.new();
		const sovrynSwapSimulator = await TestSovrynSwap.new(feeds.address);
		await sovryn.setSovrynSwapContractRegistryAddress(sovrynSwapSimulator.address);
		await sovryn.setSupportedTokens([underlyingToken.address, testWrbtc.address], [true, true]);
		await sovryn.setPriceFeedContract(
			feeds.address //priceFeeds
		);
		await sovryn.setSwapsImplContract(
			swaps.address // swapsImpl
		);
		await sovryn.setFeesController(lender);

		loanTokenLogicStandard = await LoanTokenLogicStandard.new();
		loanToken = await LoanToken.new(lender, loanTokenLogicStandard.address, sovryn.address, testWrbtc.address);
		await loanToken.initialize(underlyingToken.address, name, symbol); //iToken
		loanToken = await LoanTokenLogicStandard.at(loanToken.address);

		params = [
			"0x0000000000000000000000000000000000000000000000000000000000000000", // bytes32 id; // id of loan params object
			false, // bool active; // if false, this object has been disabled by the owner and can't be used for future loans
			lender, // address owner; // owner of this object
			underlyingToken.address, // address loanToken; // the token being loaned
			testWrbtc.address, // address collateralToken; // the required collateral token
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

		await testWrbtc.mint(sovryn.address, wei("500", "ether"));
		console.log("after before each in JS");
	});

	describe("Test lending using TestToken", () => {
		it("test lend to the pool", async () => {
			await lend_to_the_pool(loanToken, lender, underlyingToken, testWrbtc, sovryn);
		});

		it("test cash out from the pool", async () => {
			await cash_out_from_the_pool(loanToken, lender, underlyingToken, false);
		});

		it("test cash out from the pool more of lender balance should not fail", async () => {
			//await cash_out_from_the_pool_more_of_lender_balance_should_not_fail(loanToken, lender, underlyingToken);
			await cash_out_from_the_pool_uint256_max_should_withdraw_total_balance(loanToken, lender, underlyingToken);
		});

		it("test profit", async () => {
			await lend_to_the_pool(loanToken, lender, underlyingToken, testWrbtc, sovryn);

			// above functionn also opens a trading position, so I need to add some more funds to be able to withdraw everything
			const balanceOf0 = await loanToken.assetBalanceOf(lender);
			await underlyingToken.approve(loanToken.address, balanceOf0.toString());
			await loanToken.mint(account2, balanceOf0.toString());
			const profitBefore = await loanToken.profitOf(lender);
			const iTokenBalance = await loanToken.balanceOf(lender);

			// burn everything -> profit should be 0
			await loanToken.burn(lender, iTokenBalance.toString());
			const profitInt = await loanToken.profitOf(lender);

			// lend again and wait some time -> profit should rise again, but less than before, because there are more funds in the pool.
			await underlyingToken.approve(loanToken.address, balanceOf0.add(new BN(wei("100", "ether"))).toString());
			await loanToken.mint(lender, balanceOf0.toString());
			await underlyingToken.approve(loanToken.address, balanceOf0.add(new BN(wei("100", "ether"))).toString());

			await increaseTime(10000);

			const profitAfter = await loanToken.profitOf(lender);

			expect(profitInt).to.be.a.bignumber.equal(new BN(0));
			expect(profitAfter.gt(new BN(0))).to.be.true;
			expect(profitAfter.lt(profitBefore)).to.be.true;
		});

		it("Check swapExternal with minReturn > 0 should revert if minReturn is not valid (higher)", async () => {
			const balanceOf0 = await loanToken.assetBalanceOf(lender);
			await underlyingToken.approve(sovryn.address, balanceOf0.add(new BN(wei("10", "ether"))).toString());
			await expectRevert(
				sovryn.swapExternal(
					underlyingToken.address,
					testWrbtc.address,
					accounts[0],
					accounts[0],
					wei("1", "ether"),
					0,
					wei("10", "ether"),
					"0x"
				),
				"destTokenAmountReceived too low"
			);
		});

		it("Check swapExternal with minReturn > 0 should revert if minReturn is valid", async () => {
			const balanceOf0 = await loanToken.assetBalanceOf(lender);
			await underlyingToken.approve(sovryn.address, balanceOf0.add(new BN(wei("10", "ether"))).toString());
			// feeds price is set 0.01, so test minReturn with 0.01 as well for the 1 ether swap
			await sovryn.swapExternal(
				underlyingToken.address,
				testWrbtc.address,
				accounts[0],
				accounts[0],
				wei("1", "ether"),
				0,
				wei("0.01", "ether"),
				"0x"
			);
		});
	});
});
