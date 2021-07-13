const { expect } = require("chai");
const { BN } = require("@openzeppelin/test-helpers");
const { increaseTime, blockNumber } = require("../Utils/Ethereum.js");

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
	getSOV,
	lend_to_pool,
	open_margin_trade_position,
} = require("../Utils/initializer.js");

contract("ProtocolWithdrawFeeAndInterest", (accounts) => {
	let owner;
	let sovryn, SUSD, WRBTC, RBTC, BZRX, loanToken, loanTokenWRBTC, priceFeeds;

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
		sov = await getSOV(sovryn, priceFeeds, SUSD, accounts);

		const loanTokenLogicStandard = await getLoanTokenLogic();
		const loanTokenLogicWrbtc = await getLoanTokenLogicWrbtc();
		loanToken = await getLoanToken(loanTokenLogicStandard, owner, sovryn, WRBTC, SUSD);
		loanTokenWRBTC = await getLoanTokenWRBTC(loanTokenLogicWrbtc, owner, sovryn, WRBTC, SUSD);
		await loan_pool_setup(sovryn, owner, RBTC, WRBTC, SUSD, loanToken, loanTokenWRBTC);
	});

	describe("Tests withdraw fees and interest ", () => {
		it("Test withdraw accrued interest", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			const [loan_id] = await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, owner);

			let num = await blockNumber();
			let lastBlock = await web3.eth.getBlock(num);
			const initial_block_timestamp = lastBlock.timestamp;

			const loan = await sovryn.getLoan(loan_id);
			const lender = loanToken.address;

			// Time travel
			const time_until_loan_end = loan["endTimestamp"] - initial_block_timestamp;
			await increaseTime(time_until_loan_end);

			const end_interest_data_1 = await sovryn.getLenderInterestData(lender, SUSD.address);
			expect(end_interest_data_1["interestPaid"] == "0").to.be.true;

			// lend to pool to call settle interest which calls withdrawAccruedInterest
			await lend_to_pool(loanToken, SUSD, owner);
			const end_interest_data_2 = await sovryn.getLenderInterestData(lender, SUSD.address);

			num = await blockNumber();
			lastBlock = await web3.eth.getBlock(num);
			const second_block_timestamp = lastBlock.timestamp;

			const interest_owed_now = new BN(loan["endTimestamp"] - initial_block_timestamp)
				.mul(end_interest_data_1["interestOwedPerDay"])
				.div(new BN(24 * 60 * 60));

			expect(end_interest_data_2["interestOwedPerDay"].toString() != "0").to.be.true;
			expect(end_interest_data_2["interestPaid"].toString()).eq(interest_owed_now.toString());
			expect(end_interest_data_2["interestPaidDate"].toNumber() - second_block_timestamp <= 2).to.be.true;
			expect(end_interest_data_2["interestUnPaid"].eq(end_interest_data_1["interestUnPaid"].sub(interest_owed_now)));
		});

		/*
			Should successfully withdraw lending fees
			1. Set demand curve (fixture) 
			2. Lend to the pool (fixture)
			3. Make a margin trade (fixture)
			4. Set fees controller (address)
			5. Read lending fees
			6. Call withdraw lending fees
			7. Verify the right amount was paid out and the lending fees reduced on the smart contract 
		*/
		it("Test withdraw lending fees", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, owner);

			await sovryn.setFeesController(accounts[0]);
			await increaseTime(100);

			await lend_to_pool(loanToken, SUSD, owner);

			// withdraw fees and verify
			const fees = await sovryn.lendingFeeTokensHeld(SUSD.address);
			await sovryn.withdrawLendingFees(SUSD.address, accounts[1], fees);
			const paid = await sovryn.lendingFeeTokensPaid(SUSD.address);

			expect(paid.eq(fees)).to.be.true;
			expect(await sovryn.lendingFeeTokensHeld(SUSD.address)).to.be.a.bignumber.eq(new BN(0));
			expect(await SUSD.balanceOf(accounts[1])).to.be.a.bignumber.eq(fees);
		});

		/*
			Should successfully withdraw trading fees
			1. Set demand curve (fixture) 
			2. Lend to the pool (fixture)
			3. Make a margin trade (fixture)
			4. Set fees controller (address)
			5. Read trading fees
			6. Call withdraw trading fees
			7. Verify the right amount was paid out and the trading fees reduced on the smart contract 
		*/
		it("Test withdraw trading fees", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, owner);

			await sovryn.setFeesController(accounts[0]);
			await increaseTime(100);

			await lend_to_pool(loanToken, SUSD, owner);

			// withdraw fees and verify
			const fees = await sovryn.tradingFeeTokensHeld(SUSD.address);
			await sovryn.withdrawTradingFees(SUSD.address, accounts[1], fees);
			const paid = await sovryn.tradingFeeTokensPaid(SUSD.address);

			expect(paid.eq(fees)).to.be.true;
			expect(await sovryn.tradingFeeTokensHeld(SUSD.address)).to.be.a.bignumber.eq(new BN(0));
			expect(await SUSD.balanceOf(accounts[1])).to.be.a.bignumber.eq(fees);
		});

		/*
			Should successfully withdraw borrowing fees
			1. Set demand curve (fixture) 
			2. Lend to the pool (fixture)
			3. Make a margin trade (fixture)
			4. Set fees controller (address)
			5. Read borrowing fees
			6. Call withdraw borrowing fees
			7. Verify the right amount was paid out and the borrowing fees reduced on the smart contract 
		*/
		it("Test withdraw borrowing fees", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, owner);

			await sovryn.setFeesController(accounts[0]);
			await increaseTime(100);

			await lend_to_pool(loanToken, SUSD, owner);

			// withdraw fees and verify
			const fees = await sovryn.borrowingFeeTokensHeld(SUSD.address);
			await sovryn.withdrawBorrowingFees(SUSD.address, accounts[1], fees);
			const paid = await sovryn.borrowingFeeTokensPaid(SUSD.address);

			expect(paid.eq(fees)).to.be.true;
			expect(await sovryn.borrowingFeeTokensHeld(SUSD.address)).to.be.a.bignumber.eq(new BN(0));
			expect(await SUSD.balanceOf(accounts[1])).to.be.a.bignumber.eq(fees);
		});
	});
});
