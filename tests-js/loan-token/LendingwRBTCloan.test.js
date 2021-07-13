const { expect } = require("chai");
const { expectRevert, expectEvent, constants, BN, balance, time } = require("@openzeppelin/test-helpers");
//const { mineBlock, increaseTime } = require("../Utils/Ethereum");

const TestToken = artifacts.require("TestToken");
const TestWrbtc = artifacts.require("TestWrbtc");

const sovrynProtocol = artifacts.require("sovrynProtocol");
const ProtocolSettings = artifacts.require("ProtocolSettings");
const ISovryn = artifacts.require("ISovryn");

const LoanToken = artifacts.require("LoanToken");
const LoanTokenLogicWrbtc = artifacts.require("LoanTokenLogicWrbtc");
const LoanSettings = artifacts.require("LoanSettings");
const LoanMaintenance = artifacts.require("LoanMaintenance");
const LoanOpenings = artifacts.require("LoanOpenings");
const LoanClosingsBase = artifacts.require("LoanClosingsBase");
const LoanClosingsWith = artifacts.require("LoanClosingsWith");
const SwapsExternal = artifacts.require("SwapsExternal");

const PriceFeedsLocal = artifacts.require("PriceFeedsLocal");
const TestSovrynSwap = artifacts.require("TestSovrynSwap");
const SwapsImplLocal = artifacts.require("SwapsImplLocal");

const Affiliates = artifacts.require("Affiliates");
const SOV = artifacts.require("SOV");
const LockedSOVMockup = artifacts.require("LockedSOVMockup");

const TOTAL_SUPPLY = web3.utils.toWei("1000", "ether");

const {
	verify_start_conditions,
	verify_lending_result_and_itoken_price_change,
	lend_to_the_pool,
	cash_out_from_the_pool,
	cash_out_from_the_pool_more_of_lender_balance_should_not_fail,
} = require("./helpers");
//const { artifacts } = require("hardhat");

const wei = web3.utils.toWei;
const oneEth = new BN(wei("1", "ether"));
const hunEth = new BN(wei("100", "ether"));

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
		const swaps = await SwapsImplLocal.new();
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

		tokenSOV = await SOV.new(TOTAL_SUPPLY);
		await sovryn.setLockedSOVAddress((await LockedSOVMockup.new(tokenSOV.address, [lender])).address);
		await sovryn.setProtocolTokenAddress(tokenSOV.address);
		await sovryn.setSOVTokenAddress(tokenSOV.address);

		loanTokenLogicWrbtc = await LoanTokenLogicWrbtc.new();
		loanToken = await LoanToken.new(lender, loanTokenLogicWrbtc.address, sovryn.address, testWrbtc.address);
		await loanToken.initialize(testWrbtc.address, "iWRBTC", "iWRBTC"); //iToken
		loanToken = await LoanTokenLogicWrbtc.at(loanToken.address);

		params = [
			"0x0000000000000000000000000000000000000000000000000000000000000000", // bytes32 id; // id of loan params object
			false, // bool active; // if false, this object has been disabled by the owner and can't be used for future loans
			lender, // address owner; // owner of this object
			testWrbtc.address, // address loanToken; // the token being loaned
			underlyingToken.address, // address collateralToken; // the required collateral token
			wei("20", "ether"), // uint256 minInitialMargin; // the minimum allowed initial margin
			wei("15", "ether"), // uint256 maintenanceMargin; // an unhealthy loan when current margin is at or below this value
			2419200, // uint256 maxLoanTerm; // the maximum term for new loans (0 means there's no max term)
		];

		await loanToken.setupLoanParams([params], false);
		await loanToken.setupLoanParams([params], true);

		const loanTokenAddress = await loanToken.loanTokenAddress();
		if (lender == (await sovryn.owner())) await sovryn.setLoanPool([loanToken.address], [loanTokenAddress]);

		await testWrbtc.mint(sovryn.address, wei("500", "ether"));
	});
	describe("test lending using wRBTC as loanToken", () => {
		it("test lend to the pool", async () => {
			const baseRate = wei("1", "ether");
			const rateMultiplier = wei("20.25", "ether");
			const targetLevel = wei("80", "ether");
			const kinkLevel = wei("90", "ether");
			const maxScaleRate = wei("100", "ether");

			await loanToken.setDemandCurve(baseRate, rateMultiplier, baseRate, rateMultiplier, targetLevel, kinkLevel, maxScaleRate);

			borrow_interest_rate = await loanToken.borrowInterestRate();
			expect(borrow_interest_rate.gt(baseRate)).to.be.true;

			const deposit_amount = new BN(wei("4", "ether"));
			const loan_token_sent = new BN(wei("1", "ether"));
			let initial_balance = new BN(0);
			const actual_initial_balance = new BN(await web3.eth.getBalance(lender));

			await verify_start_conditions(testWrbtc, loanToken, lender, initial_balance, deposit_amount);
			await loanToken.mintWithBTC(lender, false, { value: deposit_amount });

			initial_balance = new BN(wei("5", "ether"));
			await verify_lending_result_and_itoken_price_change(
				testWrbtc,
				underlyingToken,
				loanToken,
				lender,
				loan_token_sent,
				deposit_amount,
				sovryn,
				true
			);

			const new_balance = new BN(await web3.eth.getBalance(lender));
			expect(new_balance.lt(actual_initial_balance)).to.be.true;
		});

		it("test cash out from the pool", async () => {
			await cash_out_from_the_pool(loanToken, lender, testWrbtc, true);
		});

		it("test cash out from the pool more of lender balance should not fail", async () => {
			const total_deposit_amount = new BN(wei("200", "ether"));
			await loanToken.mintWithBTC(lender, false, { value: total_deposit_amount.toString() });
			const balance_after_lending = await web3.eth.getBalance(lender);
			await expectRevert(loanToken.burnToBTC(lender, total_deposit_amount.mul(new BN(2)).toString(), false), "32");
			await loanToken.burnToBTC(lender, constants.MAX_UINT256, false);
			expect(await loanToken.balanceOf(lender)).to.be.a.bignumber.equal(new BN(0));
		});
	});
});
