//const { assert, expect } = require("chai");

const LoanTokenLogicStandard = artifacts.require("LoanTokenLogicStandard");
const sovrynProtocol = artifacts.require("sovrynProtocol");
const LoanToken = artifacts.require("LoanToken");

const TestWrbtc = artifacts.require("TestWrbtc");
const TestToken = artifacts.require("TestToken");
const ISovryn = artifacts.require("ISovryn");
const ProtocolSettings = artifacts.require("ProtocolSettings");
const LoanSettings = artifacts.require("LoanSettings");
const LoanMaintenance = artifacts.require("LoanMaintenance");

const PriceFeedsLocal = artifacts.require("PriceFeedsLocal");

const FlashLoaner = artifacts.require("FlashLoanerTest");
const ArbitraryCaller = artifacts.require("ArbitraryCaller");

const { BN, constants, expectEvent, expectRevert } = require("@openzeppelin/test-helpers");

contract("Flash loan with whitelisting", (accounts) => {
	let loanTokenLogic;
	let testWrbtc;
	let doc;
	let sovryn;
	let loanTokenV2;
	let wei = web3.utils.toWei;
	let flashLoaner;
	let arbitraryCaller;
	before(async () => {
		[owner, trader, referrer, flashLoanUser, account2, ...accounts] = accounts;
		arbitraryCaller = await ArbitraryCaller.new();
		flashLoaner = await FlashLoaner.new();
	});
	beforeEach(async () => {
		loanTokenLogic = await LoanTokenLogicStandard.new();
		testWrbtc = await TestWrbtc.new();
		doc = await TestToken.new("dollar on chain", "DOC", 18, web3.utils.toWei("20000", "ether"));

		// Deploying sovrynProtocol
		const sovrynproxy = await sovrynProtocol.new();
		sovryn = await ISovryn.at(sovrynproxy.address);
		await sovryn.replaceContract((await ProtocolSettings.new()).address);
		await sovryn.replaceContract((await LoanSettings.new()).address);
		await sovryn.replaceContract((await LoanMaintenance.new()).address);
		await sovryn.setSovrynProtocolAddress(sovrynproxy.address);

		loanToken = await LoanToken.new(owner, loanTokenLogic.address, sovryn.address, testWrbtc.address);
		await loanToken.initialize(doc.address, "SUSD", "SUSD"); //iToken

		loanTokenV2 = await LoanTokenLogicStandard.at(loanToken.address);
		await loanTokenV2.setArbitraryCallerAddress(arbitraryCaller.address);
		const loanTokenAddress = await loanToken.loanTokenAddress(); //loanToken is DoC
		if (owner == (await sovryn.owner())) {
			await sovryn.setLoanPool([loanTokenV2.address], [loanTokenAddress]); //iToken <-> loanToken
		}
	});
	beforeEach(async () => {
		// initializing
		const feeds = await PriceFeedsLocal.new(testWrbtc.address, sovryn.address);
		await feeds.setRates(doc.address, testWrbtc.address, wei("0.01", "ether"));

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

		// GIVING SOME DOC tokens to loanToken so that we can borrow from loanToken
		await doc.transfer(loanTokenV2.address, wei("500", "ether"));
	});
	it("Flash loan amount with whitelisted address", async () => {
		await loanTokenV2.addToFlashLoanWhiteList(flashLoaner.address);
		let amount = wei("250", "ether");
		let tx = await flashLoaner.doStuffWithFlashLoan(doc.address, loanTokenV2.address, amount);
		expectEvent(tx, "BalanceOf", { balance: new BN(0) });
		expectEvent(tx, "ExecuteOperation", { loanToken: doc.address, iToken: loanTokenV2.address, loanAmount: amount });
		expectEvent(tx, "BalanceOfAfterRepaid", { balance: new BN(0) });
	});

	it("Flash loan amount with not whitelisted address", async () => {
		await loanTokenV2.addToFlashLoanWhiteList(flashLoaner.address);
		await loanTokenV2.removeFromFlashLoanWhiteList(flashLoaner.address);
		let amount = wei("100", "ether");
		await expectRevert(
			flashLoaner.doStuffWithFlashLoan(doc.address, loanTokenV2.address, amount),
			"account is not whitelisted for flash loans"
		);
	});

	it("Flash loan amount edge cases", async () => {
		let amount = wei("100", "ether");
		await loanTokenV2.addToFlashLoanWhiteList(flashLoaner.address);
		await expectRevert(flashLoaner.doStuffWithFlashLoan(doc.address, loanTokenV2.address, new BN(0)), "38");
		await expectRevert(flashLoaner.doStuffWithFlashLoan(doc.address, loanTokenV2.address, wei("100000", "ether")), "39");

		await loanTokenV2.setArbitraryCallerAddress(constants.ZERO_ADDRESS);
		await expectRevert(
			flashLoaner.doStuffWithFlashLoan(doc.address, loanTokenV2.address, wei("100", "ether")),
			"arbitraryCallerAddress is not set"
		);
	});
});
