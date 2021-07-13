const { expect } = require("chai");
const { expectRevert, BN } = require("@openzeppelin/test-helpers");
const TestToken = artifacts.require("TestToken");
const LoanTokenLogicStandard = artifacts.require("LoanTokenLogicStandard");
const LoanTokenSettingsLowerAdmin = artifacts.require("LoanTokenSettingsLowerAdmin");

const {
	getSUSD,
	getRBTC,
	getWRBTC,
	getBZRX,
	getLoanTokenLogic,
	getLoanToken,
	getLoanTokenWRBTC,
	loan_pool_setup,
	lend_to_pool,
	getPriceFeeds,
	getSovryn,
	getSOV,
	decodeLogs,
	open_margin_trade_position,
	CONSTANTS,
} = require("../Utils/initializer.js");

const wei = web3.utils.toWei;

const oneEth = new BN(wei("1", "ether"));
const hunEth = new BN(wei("100", "ether"));

// This decodes longs for a single event type, and returns a decoded object in
// the same form truffle-contract uses on its receipts

contract("LoanTokenAdministration", (accounts) => {
	let owner;
	let sovryn, SUSD, WRBTC, RBTC, BZRX, loanToken, loanTokenWRBTC;

	before(async () => {
		[owner] = accounts;
	});

	beforeEach(async () => {
		SUSD = await getSUSD();
		RBTC = await getRBTC();
		WRBTC = await getWRBTC();
		BZRX = await getBZRX();
		const priceFeeds = await getPriceFeeds(WRBTC, SUSD, RBTC, sovryn, BZRX);

		sovryn = await getSovryn(WRBTC, SUSD, RBTC, priceFeeds);
		sov = await getSOV(sovryn, priceFeeds, SUSD, accounts);

		const loanTokenLogicStandard = await getLoanTokenLogic();
		loanToken = await getLoanToken(loanTokenLogicStandard, owner, sovryn, WRBTC, SUSD);
		loanTokenWRBTC = await getLoanTokenWRBTC(loanTokenLogicStandard, owner, sovryn, WRBTC, SUSD);
		await loan_pool_setup(sovryn, owner, RBTC, WRBTC, SUSD, loanToken, loanTokenWRBTC);
	});

	describe("Test administration", () => {
		it("Test demand curve setting", async () => {
			const baseRate = wei("1", "ether");
			const rateMultiplier = wei("20.25", "ether");
			const targetLevel = wei("80", "ether");
			const kinkLevel = wei("90", "ether");
			const maxScaleRate = wei("100", "ether");

			const localLoanToken = await LoanTokenLogicStandard.at(loanToken.address);
			await localLoanToken.setDemandCurve(baseRate, rateMultiplier, baseRate, rateMultiplier, targetLevel, kinkLevel, maxScaleRate);

			expect((await loanToken.baseRate()).toString() == baseRate);
			expect((await loanToken.rateMultiplier()).toString() == rateMultiplier);
			expect((await loanToken.lowUtilBaseRate()).toString() == baseRate);
			expect((await loanToken.lowUtilRateMultiplier()).toString() == rateMultiplier);

			const borrowInterestRate = await loanToken.borrowInterestRate();
			expect(borrowInterestRate.gt(oneEth)).to.be.true;
		});

		it("Test demand curve setting should fail if rateMultiplier plus baseRate is grater than 100%", async () => {
			const incorrect_baseRate = wei("51", "ether");
			const incorrect_rateMultiplier = wei("50", "ether");
			const baseRate = wei("1", "ether");
			const rateMultiplier = wei("20.25", "ether");
			const targetLevel = wei("80", "ether");
			const kinkLevel = wei("90", "ether");
			const maxScaleRate = wei("100", "ether");

			const localLoanToken = await LoanTokenLogicStandard.at(loanToken.address);
			await expectRevert.unspecified(
				localLoanToken.setDemandCurve(
					incorrect_baseRate,
					incorrect_rateMultiplier,
					baseRate,
					rateMultiplier,
					targetLevel,
					kinkLevel,
					maxScaleRate
				)
			);
			await expectRevert.unspecified(
				localLoanToken.setDemandCurve(
					baseRate,
					rateMultiplier,
					incorrect_baseRate,
					incorrect_rateMultiplier,
					targetLevel,
					kinkLevel,
					maxScaleRate
				)
			);
		});

		it("Test lending fee setting", async () => {
			await sovryn.setLendingFeePercent(hunEth);
			expect((await sovryn.lendingFeePercent()).eq(hunEth)).to.be.true;
		});

		/*
			1. pause a function
			2. try to call the function - should fail
			3. reactivate it
			4. try to call the function - should succeed
		*/
		it("Test toggle function pause", async () => {
			await lend_to_pool(loanToken, SUSD, owner);
			const functionSignature = "marginTrade(bytes32,uint256,uint256,uint256,address,address,bytes)";

			// pause the given function and make sure the function can't be called anymore
			let localLoanToken = await LoanTokenLogicStandard.at(loanToken.address);
			await localLoanToken.setPauser(accounts[0]);
			await localLoanToken.toggleFunctionPause(functionSignature, true);

			await expectRevert(open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, accounts[1]), "unauthorized");

			// check if checkPause returns true
			assert(localLoanToken.checkPause(functionSignature));

			// reactivate the given function and make sure the function can be called again
			localLoanToken = await LoanTokenLogicStandard.at(loanToken.address);
			await localLoanToken.setPauser(accounts[0]);
			await localLoanToken.toggleFunctionPause(functionSignature, false);
			await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, accounts[1]);

			// check if checkPause returns false
			expect(await localLoanToken.checkPause(functionSignature)).to.be.false;
		});

		// call toggleFunction with a non-admin address and make sure it fails
		it("Test toggle function pause with non admin should fail", async () => {
			let localLoanToken = await LoanTokenLogicStandard.at(loanToken.address);
			await expectRevert(localLoanToken.toggleFunctionPause("mint(address,uint256)", true, { from: accounts[1] }), "onlyPauser");
		});
	});
});
