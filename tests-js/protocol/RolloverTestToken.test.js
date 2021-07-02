const { expect } = require("chai");
const { BN } = require("@openzeppelin/test-helpers");
const FeesEvents = artifacts.require("FeesEvents");
const LoanOpeningsEvents = artifacts.require("LoanOpeningsEvents");
const SwapsEvents = artifacts.require("SwapsEvents");
const { increaseTime, blockNumber } = require("../Utils/Ethereum");

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
	getPriceFeeds,
	getSovryn,
	decodeLogs,
	getSOV,
	verify_sov_reward_payment,
} = require("../Utils/initializer.js");

const wei = web3.utils.toWei;

const oneEth = new BN(wei("1", "ether"));
const hunEth = new BN(wei("100", "ether"));

/*
Tests the close with deposit. 
Note: close with swap is tested in loanToken/trading

1. Test a full closure with deposit
2. Test a partial closure with deposit
3. Should fail to close with 0 deposit 
*/

contract("ProtocolCloseDeposit", (accounts) => {
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
		SOV = await getSOV(sovryn, priceFeeds, SUSD);
	});

	const setup_rollover_test = async (RBTC, SUSD, accounts, loanToken, set_demand_curve, sovryn) => {
		await set_demand_curve(loanToken);
		await SUSD.approve(loanToken.address, new BN(10).pow(new BN(40)));
		const lender = accounts[0];
		const borrower = accounts[1];
		await loanToken.mint(lender, new BN(10).pow(new BN(30)));
		const loan_token_sent = hunEth;
		await SUSD.mint(borrower, loan_token_sent);
		await SUSD.approve(loanToken.address, loan_token_sent, { from: borrower });
		const { receipt } = await loanToken.marginTrade(
			"0x0", // loanId  (0 for new loans)
			new BN(2).mul(oneEth), // leverageAmount
			loan_token_sent, // loanTokenSent
			0, // no collateral token sent
			RBTC.address, // collateralTokenAddress
			borrower, // trader,
			0,
			"0x", // loanDataBytes (only required with ether)
			{ from: borrower }
		);

		const decode = decodeLogs(receipt.rawLogs, LoanOpeningsEvents, "Trade");
		const loan_id = decode[0].args["loanId"];
		const loan = await sovryn.getLoan(loan_id);
		const num = await blockNumber();
		let currentBlock = await web3.eth.getBlock(num);
		const block_timestamp = currentBlock.timestamp;
		const time_until_loan_end = loan["endTimestamp"] - block_timestamp;
		await increaseTime(time_until_loan_end);
		return [borrower, loan, loan_id, parseInt(loan["endTimestamp"])];
	};

	describe("Tests the close with deposit. ", () => {
		/*
			Tests paid interests to lender
			Test that loan attributes are updated
			Test loan swap event
		*/
		it("Test rollover", async () => {
			// prepare the test

			const [borrower, loan, loan_id, endTimestamp] = await setup_rollover_test(
				RBTC,
				SUSD,
				accounts,
				loanToken,
				set_demand_curve,
				sovryn
			);

			const lender_interest_data = await sovryn.getLenderInterestData(loanToken.address, SUSD.address);

			const lender_pool_initial_balance = await SUSD.balanceOf(loanToken.address);
			const sov_borrower_initial_balance = await SOV.balanceOf(borrower);
			const { receipt } = await sovryn.rollover(loan_id, "0x");
			const susd_bal_after_rollover = (await SUSD.balanceOf(loanToken.address)).toString();

			const lender_interest_after = await sovryn.getLenderInterestData(loanToken.address, SUSD.address);

			const lending_fee_percent = await sovryn.lendingFeePercent();
			const interest_unpaid = new BN(lender_interest_data["interestUnPaid"]);
			const lending_fee = interest_unpaid.mul(lending_fee_percent).div(hunEth);
			let interest_owed_now = interest_unpaid.sub(lending_fee);

			num = await blockNumber();
			currentBlock = await web3.eth.getBlock(num);
			block_timestamp = currentBlock.timestamp;
			if (block_timestamp > endTimestamp) {
				backInterestTime = new BN(block_timestamp - endTimestamp);
				backInterestOwed = backInterestTime.mul(lender_interest_data["interestOwedPerDay"]).div(new BN(24 * 60 * 60));
				const lending_fee = backInterestOwed.mul(lending_fee_percent).div(hunEth);
				backInterestOwed = backInterestOwed.sub(lending_fee);
				interest_owed_now = interest_owed_now.add(backInterestOwed);
			}

			expect(await SUSD.balanceOf(loanToken.address)).to.be.bignumber.equal(lender_pool_initial_balance.add(interest_owed_now));
			expect(lender_interest_after["interestPaid"] == interest_unpaid.toString()).to.be.true;
			expect(lender_interest_after["interestUnPaid"] == "0").to.be.true;

			// Settles and pays borrowers based on fees generated by their interest payments
			if ((await sovryn.protocolTokenHeld()) != 0)
				await verify_sov_reward_payment(receipt.rawLogs, FeesEvents, SOV, borrower, loan_id, sov_borrower_initial_balance, 2);

			const loan_after = await sovryn.getLoan(loan_id);
			expect(loan_after["endTimestamp"] >= parseInt(loan["endTimestamp"]) + 28 * 24 * 60 * 60).to.be.true;
			const { rate: trade_rate, precision } = await priceFeeds.queryRate(RBTC.address, SUSD.address);
			const trading_fee_percent = await sovryn.tradingFeePercent();
			const trading_fee = interest_unpaid.mul(trading_fee_percent).div(hunEth);

			const decode = decodeLogs(receipt.rawLogs, SwapsEvents, "LoanSwap");
			const loan_swap_event = decode[0].args;
			expect(loan_swap_event["loanId"] == loan_id).to.be.true;
			expect(loan_swap_event["sourceToken"] == RBTC.address).to.be.true;
			expect(loan_swap_event["destToken"] == SUSD.address).to.be.true;
			expect(loan_swap_event["borrower"] == borrower).to.be.true;
			// source buffer = 10000 in sovryn swap connector
			expect(
				new BN(loan_swap_event["sourceAmount"])
					.sub(interest_unpaid)
					.add(trading_fee)
					.mul(precision)
					.div(trade_rate)
					.lte(new BN(10000))
			).to.be.true;
			expect(new BN(loan_swap_event["destAmount"]).gte(interest_unpaid)).to.be.true;
		});

		/*
			Collateral should decrease
			Sender collateral balance should increase
		*/
		it("Test rollover reward payment", async () => {
			// prepare the test
			const [, initial_loan, loan_id] = await setup_rollover_test(RBTC, SUSD, accounts, loanToken, set_demand_curve, sovryn);

			const num = await blockNumber();
			let currentBlock = await web3.eth.getBlock(num);
			const block_timestamp = currentBlock.timestamp;
			const time_until_loan_end = initial_loan["endTimestamp"] - block_timestamp;
			await increaseTime(time_until_loan_end);

			const receiver = accounts[3];
			expect((await RBTC.balanceOf(receiver)).toNumber() == 0).to.be.true;
			const { receipt } = await sovryn.rollover(loan_id, "0x", { from: receiver });

			const end_loan = await sovryn.getLoan(loan_id);
			const decode = decodeLogs(receipt.rawLogs, SwapsEvents, "LoanSwap");
			const loan_swap_event = decode[0].args;
			const source_token_amount_used = new BN(loan_swap_event["sourceAmount"]);

			// end_collateral = initial_loan['collateral'] - source_token_amount_used - rollover_reward
			const rollover_reward = new BN(initial_loan["collateral"]).sub(source_token_amount_used).sub(new BN(end_loan["collateral"]));

			expect((await RBTC.balanceOf(receiver)).gte(rollover_reward)).to.be.true;
		});
	});
});
