const { expect } = require("chai");
const { expectRevert, BN } = require("@openzeppelin/test-helpers");
const LoanMaintenance = artifacts.require("LoanMaintenance");
const FeesEvents = artifacts.require("FeesEvents");
const { increaseTime } = require("../Utils/Ethereum");
const LockedSOVMockup = artifacts.require("LockedSOVMockup");
const LockedSOVFailedMockup = artifacts.require("LockedSOVFailedMockup");

const {
	getSUSD,
	getRBTC,
	getWRBTC,
	getBZRX,
	getLoanTokenLogic,
	getLoanToken,
	getLoanTokenLogicWrbtc,
	getLoanTokenWRBTC,
	loan_pool_setup,
	set_demand_curve,
	lend_to_pool,
	getPriceFeeds,
	getSovryn,
	decodeLogs,
	open_margin_trade_position,
	borrow_indefinite_loan,
	getSOV,
} = require("../Utils/initializer.js");

const wei = web3.utils.toWei;

const oneEth = new BN(wei("1", "ether"));

/*
Test extending and reducing loan durations.
1. Should fail to extend a fixed-term loan
2. Extend  a loan
3. Should fail to extend a loan with 0 deposit 
4. Should fail to extend a closed loan
5. Should fail to extend another user's loan
6. Extend a loan with collateral
7. Should fail to extend a loan with collateral tokens and rBTC value
8. Should fail to reduce the duration of a fixed-term loan
9. Reduce the duration of a loan
10. Should fail to reduce the loan duration without withdrawing some funds
11. Should fail to reduce the loan duration of a closed loan
12. Should fail to reduce the loan duration of another user's loan
13. Should fail to reduce the loan duration if the max duration was already surpassed
14. Should fail to reduce the loan duration when withdrawing too much
15. Should fail to reduce the loan duration by less than an hour
*/

contract("ProtocolChangeLoanDuration", (accounts) => {
	let owner;
	let sovryn, SUSD, WRBTC, RBTC, BZRX, loanToken, loanTokenWRBTC, priceFeeds, SOV;

	before(async () => {
		[owner] = accounts;
	});

	beforeEach(async () => {
		SUSD = await getSUSD();
		RBTC = await getRBTC();
		WRBTC = await getWRBTC();
		BZRX = await getBZRX();
		priceFeeds = await getPriceFeeds(WRBTC, SUSD, RBTC, sovryn, BZRX);

		sovryn = await getSovryn(WRBTC, SUSD, RBTC, priceFeeds);

		const loanTokenLogicStandard = await getLoanTokenLogic();
		const loanTokenLogicWrbtc = await getLoanTokenLogicWrbtc();
		loanToken = await getLoanToken(loanTokenLogicStandard, owner, sovryn, WRBTC, SUSD);
		loanTokenWRBTC = await getLoanTokenWRBTC(loanTokenLogicWrbtc, owner, sovryn, WRBTC, SUSD);
		await loan_pool_setup(sovryn, owner, RBTC, WRBTC, SUSD, loanToken, loanTokenWRBTC);
		SOV = await getSOV(sovryn, priceFeeds, SUSD, accounts);
	});

	describe("Test set new special rebates.", () => {
		it("Test set new special rebates for specific pairs", async () => {
			const invalidValue = wei("1001", "ether");
			await expectRevert(sovryn.setSpecialRebates(SUSD.address, RBTC.address, 0, { from: accounts[8] }), "unauthorized");
			await expectRevert(sovryn.setSpecialRebates(SUSD.address, RBTC.address, invalidValue), "Special fee rebate is too high");

			const validValue = wei("200", "ether");
			await sovryn.setSpecialRebates(SUSD.address, RBTC.address, validValue);
			expect((await sovryn.specialRebates(SUSD.address, RBTC.address)).toString(), "Incorrect new special fee rebates").to.be.equal(
				validValue.toString()
			);
		});
	});

	describe("Test extending and reducing loan durations.", () => {
		/*
			At this moment the maxLoanTerm is always 28 because it is hardcoded in setupLoanParams.
			So there are only fix-term loans.
		*/
		it("Test extend fix term loan duration should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, trader, loan_token_sent] = await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, owner);
			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(
				loanMaintenance.extendLoanDuration(loan_id, loan_token_sent, false, "0x", { from: trader }),
				"indefinite-term only"
			);
		});

		/*
			Extend the loan duration and see if the new timestamp is the expected, the interest increase,
			the borrower SUSD balance decrease and the sovryn SUSD balance increase
		*/
		it("Test extend loan duration", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);

			const [loan_id, borrower] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);
			const initial_loan = await sovryn.getLoan(loan_id);
			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);
			const initial_loan_token_lender_balance = await SUSD.balanceOf(sovryn.address);

			const days_to_extend = new BN(10);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const deposit_amount = owed_per_day.mul(days_to_extend);

			// Approve the transfer of loan token
			await SUSD.mint(borrower, deposit_amount);
			await SUSD.approve(sovryn.address, deposit_amount, { from: borrower });
			const initial_borrower_balance = await SUSD.balanceOf(borrower);

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await loanMaintenance.extendLoanDuration(loan_id, deposit_amount, false, "0x", { from: borrower });

			const end_loan_interest_data = await sovryn.getLoanInterestData(loan_id);
			const end_loan = await sovryn.getLoan(loan_id);

			expect(end_loan["endTimestamp"] == parseInt(initial_loan["endTimestamp"]) + days_to_extend.toNumber() * 24 * 60 * 60).to.be
				.true;
			expect(
				end_loan_interest_data["interestDepositTotal"].eq(initial_loan_interest_data["interestDepositTotal"].add(deposit_amount))
			).to.be.true;
			expect((await SUSD.balanceOf(borrower)).eq(initial_borrower_balance.sub(deposit_amount))).to.be.true;
			// Due to block timestamp could be paying outstanding interest to lender or not
			expect((await SUSD.balanceOf(sovryn.address)).lte(initial_loan_token_lender_balance.add(deposit_amount))).to.be.true;
		});

		it("Test extend loan_duration 0 deposit should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);

			const [loan_id, borrower] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);
			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(loanMaintenance.extendLoanDuration(loan_id, 0, false, "0x", { from: borrower }), "depositAmount is 0");
		});

		it("Test extend closed loan_duration should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, borrower, , , , , args] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);
			const collateral = args["newCollateral"];
			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_extend = new BN(10);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const deposit_amount = owed_per_day.mul(days_to_extend);

			await sovryn.closeWithSwap(loan_id, borrower, collateral, false, "0x", { from: borrower });

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(
				loanMaintenance.extendLoanDuration(loan_id, deposit_amount, false, "0x", { from: borrower }),
				"loan is closed"
			);
		});

		it("Test extend loan_duration user unauthorized should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, , receiver, , , ,] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);
			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_extend = new BN(10);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const deposit_amount = owed_per_day.mul(days_to_extend);

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(loanMaintenance.extendLoanDuration(loan_id, deposit_amount, true, "0x", { from: receiver }), "unauthorized");
		});

		/*
			Extend the loan duration with collateral and see if the new timestamp is the expected, the interest increase,
			the loan's collateral decrease, sovryn SUSD balance increase and RBTC decrease
		*/
		it("Test extend loan_duration with collateral", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, borrower] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);

			const initial_loan = await sovryn.getLoan(loan_id);
			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);
			const initial_loan_token_lender_balance = await SUSD.balanceOf(sovryn.address);
			const initial_collateral_token_lender_balance = await RBTC.balanceOf(sovryn.address);

			const days_to_extend = new BN(10);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const deposit_amount = owed_per_day.mul(days_to_extend);

			const { rate, precision } = await priceFeeds.queryRate(RBTC.address, SUSD.address);
			let deposit_amount_in_collateral = deposit_amount.mul(precision).div(rate);

			// if the actual rate is exactly the same as the worst case rate, we get rounding issues. So, add a small buffer.
			// buffer = min(estimatedSourceAmount/1000 , sourceBuffer) with sourceBuffer = 10000
			// code from SwapsImplSovrynSwap.sol

			let buffer = deposit_amount_in_collateral.div(new BN(1000));
			if (buffer.gt(new BN(10000))) buffer = new BN(10000);
			deposit_amount_in_collateral = deposit_amount_in_collateral.add(buffer);

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await loanMaintenance.extendLoanDuration(loan_id, deposit_amount, true, "0x", { from: borrower });

			const end_loan_interest_data = await sovryn.getLoanInterestData(loan_id);
			const end_loan = await sovryn.getLoan(loan_id);

			expect(end_loan["endTimestamp"] == parseInt(initial_loan["endTimestamp"]) + days_to_extend.toNumber() * 24 * 60 * 60).to.be
				.true;
			expect(
				end_loan_interest_data["interestDepositTotal"].eq(initial_loan_interest_data["interestDepositTotal"].add(deposit_amount))
			).to.be.true;
			expect(new BN(end_loan["collateral"])).to.be.a.bignumber.eq(
				new BN(initial_loan["collateral"]).sub(deposit_amount_in_collateral)
			);
			expect(await RBTC.balanceOf(sovryn.address)).to.be.a.bignumber.eq(
				initial_collateral_token_lender_balance.sub(deposit_amount_in_collateral)
			);
			expect((await SUSD.balanceOf(sovryn.address)).lte(initial_loan_token_lender_balance.add(deposit_amount))).to.be.true;
		});

		it("EarnRewardFail events should be fired if lockedSOV reverted when extend loan_duration with collateral sov token reward (special rebates not set or 0)", async () => {
			// prepare the test
			await sovryn.setLockedSOVAddress((await LockedSOVFailedMockup.new(SOV.address, [owner])).address);
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, borrower] = await borrow_indefinite_loan(
				loanToken,
				sovryn,
				SUSD,
				RBTC,
				accounts,
				(withdraw_amount = new BN(10).mul(oneEth).toString()),
				(margin = new BN(50).mul(oneEth).toString()),
				(duration_in_seconds = 60 * 60 * 24 * 20)
			);

			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_extend = new BN(10);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const deposit_amount = owed_per_day.mul(days_to_extend);

			await increaseTime(10 * 24 * 60 * 60);
			lockedSOV = await LockedSOVFailedMockup.at(await sovryn.lockedSOVAddress());
			const borrower_initial_balance_before_extend = (await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower));

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			const { receipt } = await loanMaintenance.extendLoanDuration(loan_id, deposit_amount, true, "0x", { from: borrower });
			const borrower_initial_balance = borrower_initial_balance_before_extend.sub(
				(await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower))
			);

			expect(borrower_initial_balance_before_extend.toString()).to.eq(borrower_initial_balance.toString());

			const feeRebatePercent = await sovryn.feeRebatePercent();
			const decode = decodeLogs(receipt.rawLogs, FeesEvents, "EarnRewardFail");
			const args = decode[0].args;
			expect(args["receiver"] == borrower).to.be.true;
			expect(args["token"] == SOV.address).to.be.true;
			expect(args["loanId"] == loan_id).to.be.true;
			expect(args["feeRebatePercent"] == feeRebatePercent).to.be.true;
		});

		it("EarnRewardFail events should be fired if lockedSOV reverted when extend loan_duration with collateral sov token reward payment (special rebates is set)", async () => {
			// prepare the test
			await sovryn.setLockedSOVAddress((await LockedSOVFailedMockup.new(SOV.address, [owner])).address);
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await sovryn.setSpecialRebates(SUSD.address, RBTC.address, wei("200", "ether"));
			const [loan_id, borrower] = await borrow_indefinite_loan(
				loanToken,
				sovryn,
				SUSD,
				RBTC,
				accounts,
				(withdraw_amount = new BN(10).mul(oneEth).toString()),
				(margin = new BN(50).mul(oneEth).toString()),
				(duration_in_seconds = 60 * 60 * 24 * 20)
			);

			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_extend = new BN(10);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const deposit_amount = owed_per_day.mul(days_to_extend);

			await increaseTime(10 * 24 * 60 * 60);
			lockedSOV = await LockedSOVFailedMockup.at(await sovryn.lockedSOVAddress());
			const borrower_initial_balance_before_extend = (await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower));

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			const { receipt } = await loanMaintenance.extendLoanDuration(loan_id, deposit_amount, true, "0x", { from: borrower });
			const borrower_initial_balance = borrower_initial_balance_before_extend.sub(
				(await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower))
			);

			expect(borrower_initial_balance_before_extend.toString()).to.eq(borrower_initial_balance.toString());

			const feeRebatePercent = await sovryn.specialRebates(SUSD.address, RBTC.address);
			const decode = decodeLogs(receipt.rawLogs, FeesEvents, "EarnRewardFail");
			const args = decode[0].args;
			expect(args["receiver"] == borrower).to.be.true;
			expect(args["token"] == SOV.address).to.be.true;
			expect(args["loanId"] == loan_id).to.be.true;
			expect(args["feeRebatePercent"] == feeRebatePercent).to.be.true;
		});

		it("Test extend loan_duration with collateral sov token reward payment (special rebates not set / 0)", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, borrower] = await borrow_indefinite_loan(
				loanToken,
				sovryn,
				SUSD,
				RBTC,
				accounts,
				(withdraw_amount = new BN(10).mul(oneEth).toString()),
				(margin = new BN(50).mul(oneEth).toString()),
				(duration_in_seconds = 60 * 60 * 24 * 20)
			);

			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_extend = new BN(10);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const deposit_amount = owed_per_day.mul(days_to_extend);

			await increaseTime(10 * 24 * 60 * 60);
			lockedSOV = await LockedSOVMockup.at(await sovryn.lockedSOVAddress());
			const borrower_initial_balance_before_extend = (await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower));

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			const { receipt } = await loanMaintenance.extendLoanDuration(loan_id, deposit_amount, true, "0x", { from: borrower });
			const borrower_initial_balance = borrower_initial_balance_before_extend.sub(
				(await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower))
			);

			const feeRebatePercent = await sovryn.feeRebatePercent();
			const decode = decodeLogs(receipt.rawLogs, FeesEvents, "EarnReward");
			const args = decode[0].args;
			expect(args["receiver"] == borrower).to.be.true;
			expect(args["token"] == SOV.address).to.be.true;
			expect(args["loanId"] == loan_id).to.be.true;
			expect(args["amount"]).to.eq((await SOV.balanceOf(borrower)).sub(borrower_initial_balance).toString());
			expect(args["feeRebatePercent"] == feeRebatePercent).to.be.true;
		});

		it("Test extend loan_duration with collateral sov token reward payment (special rebates is set)", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await sovryn.setSpecialRebates(SUSD.address, RBTC.address, wei("200", "ether"));
			const [loan_id, borrower] = await borrow_indefinite_loan(
				loanToken,
				sovryn,
				SUSD,
				RBTC,
				accounts,
				(withdraw_amount = new BN(10).mul(oneEth).toString()),
				(margin = new BN(50).mul(oneEth).toString()),
				(duration_in_seconds = 60 * 60 * 24 * 20)
			);

			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_extend = new BN(10);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const deposit_amount = owed_per_day.mul(days_to_extend);

			await increaseTime(10 * 24 * 60 * 60);
			lockedSOV = await LockedSOVMockup.at(await sovryn.lockedSOVAddress());
			const borrower_initial_balance_before_extend = (await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower));

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			const { receipt } = await loanMaintenance.extendLoanDuration(loan_id, deposit_amount, true, "0x", { from: borrower });
			const borrower_initial_balance = borrower_initial_balance_before_extend.sub(
				(await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower))
			);

			const feeRebatePercent = await sovryn.specialRebates(SUSD.address, RBTC.address);
			const decode = decodeLogs(receipt.rawLogs, FeesEvents, "EarnReward");
			const args = decode[0].args;
			expect(args["receiver"] == borrower).to.be.true;
			expect(args["token"] == SOV.address).to.be.true;
			expect(args["loanId"] == loan_id).to.be.true;
			expect(args["amount"]).to.eq((await SOV.balanceOf(borrower)).sub(borrower_initial_balance).toString());
			expect(args["feeRebatePercent"] == feeRebatePercent).to.be.true;
		});

		it("Test extend loan_duration with collateral and eth should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, borrower] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);

			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_extend = new BN(10);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const deposit_amount = owed_per_day.mul(days_to_extend);

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(
				loanMaintenance.extendLoanDuration(loan_id, deposit_amount, true, "0x", { from: borrower, value: deposit_amount }),
				"wrong asset sent"
			);
		});

		it("Test reduce fix term loan duration should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, trader, loan_token_sent] = await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, owner);
			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(
				loanMaintenance.reduceLoanDuration(loan_id, trader, loan_token_sent, { from: trader }),
				"indefinite-term only"
			);
		});

		/*
			Reduce the loan duration and see if the new timestamp is the expected, the interest decrease,
			the receiver SUSD balance increase and the sovryn SUSD balance decrease
		*/
		it("Test reduce loan duration", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);

			const [loan_id, borrower] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);
			const initial_loan = await sovryn.getLoan(loan_id);
			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);
			const initial_loan_token_lender_balance = await SUSD.balanceOf(sovryn.address);

			const days_to_reduce = new BN(5);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const withdraw_amount = owed_per_day.mul(days_to_reduce);

			const receiver = accounts[3];
			const initial_receiver_balance = await SUSD.balanceOf(receiver);

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await loanMaintenance.reduceLoanDuration(loan_id, receiver, withdraw_amount, { from: borrower });

			const end_loan_interest_data = await sovryn.getLoanInterestData(loan_id);
			const end_loan = await sovryn.getLoan(loan_id);

			expect(end_loan["endTimestamp"] == parseInt(initial_loan["endTimestamp"]) - days_to_reduce.toNumber() * 24 * 60 * 60).to.be
				.true;
			expect(
				end_loan_interest_data["interestDepositTotal"].eq(initial_loan_interest_data["interestDepositTotal"].sub(withdraw_amount))
			).to.be.true;
			expect((await SUSD.balanceOf(receiver)).eq(initial_receiver_balance.add(withdraw_amount))).to.be.true;
			// Due to block timestamp could be paying outstanding interest to lender or not
			expect((await SUSD.balanceOf(sovryn.address)).lte(initial_loan_token_lender_balance.sub(withdraw_amount))).to.be.true;
		});

		it("EarnRewardFail events should be fired if lockedSOV reverted when Test reduce loan_duration with collateral sov token reward payment (special rebates not set or 0", async () => {
			// prepare the test
			await sovryn.setLockedSOVAddress((await LockedSOVFailedMockup.new(SOV.address, [owner])).address);
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const duration_in_seconds = 20 * 24 * 60 * 60; // 20 days
			const [loan_id, borrower] = await borrow_indefinite_loan(
				loanToken,
				sovryn,
				SUSD,
				RBTC,
				accounts,
				new BN(10).mul(oneEth).toString(),
				new BN(50).mul(oneEth).toString(),
				duration_in_seconds
			);

			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_reduce = new BN(5);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const withdraw_amount = owed_per_day.mul(days_to_reduce);

			const receiver = accounts[3];

			await increaseTime(10 * 24 * 60 * 60);
			lockedSOV = await LockedSOVMockup.at(await sovryn.lockedSOVAddress());
			const borrower_initial_balance_before_reduce = (await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower));

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			const { receipt } = await loanMaintenance.reduceLoanDuration(loan_id, receiver, withdraw_amount, { from: borrower });

			const borrower_initial_balance = borrower_initial_balance_before_reduce.sub(
				(await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower))
			);

			expect(borrower_initial_balance_before_reduce.toString()).to.eq(borrower_initial_balance.toString());

			const feeRebatePercent = await sovryn.feeRebatePercent();
			const decode = decodeLogs(receipt.rawLogs, FeesEvents, "EarnRewardFail");
			const args = decode[0].args;
			expect(args["receiver"] == borrower).to.be.true;
			expect(args["token"] == SOV.address).to.be.true;
			expect(args["loanId"] == loan_id).to.be.true;
			expect(args["feeRebatePercent"] == feeRebatePercent).to.be.true;
		});

		it("EarnRewardFail events should be fired if lockedSOV reverted when Test reduce loan_duration with collateral sov token reward payment (special rebates is set)", async () => {
			// prepare the test
			await sovryn.setLockedSOVAddress((await LockedSOVFailedMockup.new(SOV.address, [owner])).address);
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await sovryn.setSpecialRebates(SUSD.address, RBTC.address, wei("200", "ether"));
			const duration_in_seconds = 20 * 24 * 60 * 60; // 20 days
			const [loan_id, borrower] = await borrow_indefinite_loan(
				loanToken,
				sovryn,
				SUSD,
				RBTC,
				accounts,
				new BN(10).mul(oneEth).toString(),
				new BN(50).mul(oneEth).toString(),
				duration_in_seconds
			);

			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_reduce = new BN(5);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const withdraw_amount = owed_per_day.mul(days_to_reduce);

			const receiver = accounts[3];

			await increaseTime(10 * 24 * 60 * 60);
			lockedSOV = await LockedSOVMockup.at(await sovryn.lockedSOVAddress());
			const borrower_initial_balance_before_reduce = (await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower));

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			const { receipt } = await loanMaintenance.reduceLoanDuration(loan_id, receiver, withdraw_amount, { from: borrower });

			const borrower_initial_balance = borrower_initial_balance_before_reduce.sub(
				(await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower))
			);

			expect(borrower_initial_balance_before_reduce.toString()).to.eq(borrower_initial_balance.toString());

			const feeRebatePercent = await sovryn.specialRebates(SUSD.address, RBTC.address);
			const decode = decodeLogs(receipt.rawLogs, FeesEvents, "EarnRewardFail");
			const args = decode[0].args;
			expect(args["receiver"] == borrower).to.be.true;
			expect(args["token"] == SOV.address).to.be.true;
			expect(args["loanId"] == loan_id).to.be.true;
			expect(args["feeRebatePercent"] == feeRebatePercent).to.be.true;
		});

		it("Test reduce loan_duration 0 withdraw should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);

			const [loan_id, borrower] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);
			const receiver = accounts[3];

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(loanMaintenance.reduceLoanDuration(loan_id, receiver, 0, { from: borrower }), "withdrawAmount is 0");
		});

		it("Test reduce loan_duration with collateral sov token reward payment (special rebates not set or 0)", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const duration_in_seconds = 20 * 24 * 60 * 60; // 20 days
			const [loan_id, borrower] = await borrow_indefinite_loan(
				loanToken,
				sovryn,
				SUSD,
				RBTC,
				accounts,
				new BN(10).mul(oneEth).toString(),
				new BN(50).mul(oneEth).toString(),
				duration_in_seconds
			);

			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_reduce = new BN(5);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const withdraw_amount = owed_per_day.mul(days_to_reduce);

			const receiver = accounts[3];

			await increaseTime(10 * 24 * 60 * 60);
			lockedSOV = await LockedSOVMockup.at(await sovryn.lockedSOVAddress());
			const borrower_initial_balance_before_reduce = (await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower));

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			const { receipt } = await loanMaintenance.reduceLoanDuration(loan_id, receiver, withdraw_amount, { from: borrower });

			const borrower_initial_balance = borrower_initial_balance_before_reduce.sub(
				(await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower))
			);

			const feeRebatePercent = await sovryn.feeRebatePercent();
			const decode = decodeLogs(receipt.rawLogs, FeesEvents, "EarnReward");
			const args = decode[0].args;
			expect(args["receiver"] == borrower).to.be.true;
			expect(args["token"] == SOV.address).to.be.true;
			expect(args["loanId"] == loan_id).to.be.true;
			expect(args["amount"]).to.eq((await SOV.balanceOf(borrower)).sub(borrower_initial_balance).toString());
			expect(args["feeRebatePercent"] == feeRebatePercent).to.be.true;
		});

		it("Test reduce loan_duration with collateral sov token reward payment (special rebates is set)", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await sovryn.setSpecialRebates(SUSD.address, RBTC.address, wei("200", "ether"));
			const duration_in_seconds = 20 * 24 * 60 * 60; // 20 days
			const [loan_id, borrower] = await borrow_indefinite_loan(
				loanToken,
				sovryn,
				SUSD,
				RBTC,
				accounts,
				new BN(10).mul(oneEth).toString(),
				new BN(50).mul(oneEth).toString(),
				duration_in_seconds
			);

			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_reduce = new BN(5);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const withdraw_amount = owed_per_day.mul(days_to_reduce);

			const receiver = accounts[3];

			await increaseTime(10 * 24 * 60 * 60);
			lockedSOV = await LockedSOVMockup.at(await sovryn.lockedSOVAddress());
			const borrower_initial_balance_before_reduce = (await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower));

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			const { receipt } = await loanMaintenance.reduceLoanDuration(loan_id, receiver, withdraw_amount, { from: borrower });

			const borrower_initial_balance = borrower_initial_balance_before_reduce.sub(
				(await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower))
			);

			const feeRebatePercent = await sovryn.specialRebates(SUSD.address, RBTC.address);
			const decode = decodeLogs(receipt.rawLogs, FeesEvents, "EarnReward");
			const args = decode[0].args;
			expect(args["receiver"] == borrower).to.be.true;
			expect(args["token"] == SOV.address).to.be.true;
			expect(args["loanId"] == loan_id).to.be.true;
			expect(args["amount"]).to.eq((await SOV.balanceOf(borrower)).sub(borrower_initial_balance).toString());
			expect(args["feeRebatePercent"] == feeRebatePercent).to.be.true;
		});

		it("Test reduce loan_duration 0 withdraw should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);

			const [loan_id, borrower] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);
			const receiver = accounts[3];

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(loanMaintenance.reduceLoanDuration(loan_id, receiver, 0, { from: borrower }), "withdrawAmount is 0");
		});

		it("Test reduce closed loan_duration should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, borrower, , , , , args] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);
			const collateral = args["newCollateral"];
			const receiver = accounts[3];

			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);
			await sovryn.closeWithSwap(loan_id, borrower, collateral, false, "0x", { from: borrower });

			const days_to_reduce = new BN(5);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const withdraw_amount = owed_per_day.mul(days_to_reduce);

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(
				loanMaintenance.reduceLoanDuration(loan_id, receiver, withdraw_amount, { from: borrower }),
				"loan is closed"
			);
		});

		it("Test reduce loan_duration user unauthorized should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);

			const receiver = accounts[3];
			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_reduce = new BN(5);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const withdraw_amount = owed_per_day.mul(days_to_reduce);

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(loanMaintenance.reduceLoanDuration(loan_id, receiver, withdraw_amount, { from: receiver }), "unauthorized");
		});

		it("Test reduce loan_duration loan term ended should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, borrower] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);

			const receiver = accounts[3];
			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const days_to_reduce = new BN(5);
			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			const withdraw_amount = owed_per_day.mul(days_to_reduce);

			const initial_loan = await sovryn.getLoan(loan_id);
			const loan_end_timestamp = parseInt(initial_loan["endTimestamp"]);

			await increaseTime(loan_end_timestamp);

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(
				loanMaintenance.reduceLoanDuration(loan_id, receiver, withdraw_amount, { from: borrower }),
				"loan term has ended"
			);
		});

		it("Test reduce loan_duration withdraw amount too high should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, borrower, , withdraw_amount] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);

			const receiver = accounts[3];

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(
				loanMaintenance.reduceLoanDuration(loan_id, receiver, new BN(withdraw_amount).mul(new BN(2)), { from: borrower }),
				"withdraw amount too high"
			);
		});

		it("Test reduce loan_duration less than one hour should fail", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id, borrower, , , duration_in_seconds] = await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);

			const receiver = accounts[3];
			const initial_loan_interest_data = await sovryn.getLoanInterestData(loan_id);

			const owed_per_day = initial_loan_interest_data["interestOwedPerDay"];
			// reduce the loan upto 50 minutes
			const withdraw_amount = owed_per_day.mul(new BN(duration_in_seconds - 50 * 60)).div(new BN(24 * 60 * 60));

			const loanMaintenance = await LoanMaintenance.at(sovryn.address);
			await expectRevert(
				loanMaintenance.reduceLoanDuration(loan_id, receiver, withdraw_amount, { from: borrower }),
				"loan too short"
			);
		});
	});
});
