const { expectRevert, BN, expectEvent } = require("@openzeppelin/test-helpers");

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
	getSOV,
	borrow_indefinite_loan,
	open_margin_trade_position,
} = require("../Utils/initializer.js");

const wei = web3.utils.toWei;

const oneEth = new BN(wei("1", "ether"));

// This decodes longs for a single event type, and returns a decoded object in
// the same form truffle-contract uses on its receipts

contract("LoanTokenTransactionLimit", (accounts) => {
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
		await getSOV(sovryn, priceFeeds, SUSD, accounts);

		const loanTokenLogicStandard = await getLoanTokenLogic();
		const loanTokenLogicWrbtc = await getLoanTokenLogicWrbtc();
		loanToken = await getLoanToken(loanTokenLogicStandard, owner, sovryn, WRBTC, SUSD);
		loanTokenWRBTC = await getLoanTokenWRBTC(loanTokenLogicWrbtc, owner, sovryn, WRBTC, SUSD);
		await loan_pool_setup(sovryn, owner, RBTC, WRBTC, SUSD, loanToken, loanTokenWRBTC);
	});
	const set_transaction_limit = async (sender, addresses, limits) => {
		const tx = await loanToken.setTransactionLimits(addresses, limits, { from: sender });
		return tx;
	};

	describe("Test Limits", () => {
		// the owner should be able to set the limits
		it("Test set trasaction limit with owner", async () => {
			const tx = await set_transaction_limit(
				accounts[0],
				[SUSD.address, RBTC.address],
				[new BN(21).mul(oneEth), new BN(21).mul(oneEth).div(new BN(10000))]
			);
			expectEvent(tx, "SetTransactionLimits");
		});

		// the non-owner should fail to set the limits
		it("Test set transaction limit non owner should fail", async () => {
			expectRevert(
				set_transaction_limit(
					accounts[1],
					[SUSD.address, RBTC.address],
					[new BN(21).mul(oneEth), new BN(21).mul(oneEth).div(new BN(10000))]
				),
				"unauthorized"
			);
		});

		// the owner should fail to set the limits with invalid arrays
		it("Test set transaction limit array length mismatch should fail", async () => {
			expectRevert(
				set_transaction_limit(accounts[0], [SUSD.address], [new BN(21).mul(oneEth), new BN(21).mul(oneEth).div(new BN(10000))]),
				"mismatched array lengths"
			);
		});

		// margin trading should fail if the transfered amount exceeds the transaction limit
		it("Test margin trading exceeding limit should fail", async () => {
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await set_transaction_limit(
				accounts[0],
				[SUSD.address, RBTC.address],
				[new BN(21).mul(oneEth).div(new BN(10)), new BN(21).mul(oneEth).div(new BN(10000000))]
			);
			expectRevert.unspecified(borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts));
		});

		// borrowing should fail if the transfered amount exceeds the transaction limit
		it("Test borrowing exceeding limit should fail", async () => {
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await set_transaction_limit(
				accounts[0],
				[SUSD.address, RBTC.address],
				[new BN(21).mul(oneEth).div(new BN(10)), new BN(21).mul(oneEth).div(new BN(100000))]
			);
			expectRevert.unspecified(borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts));
		});

		// leding should fail if the transfered amount exceeds the transaction limit
		it("Test lending exceeding limit should succeed", async () => {
			await set_transaction_limit(
				accounts[0],
				[SUSD.address, RBTC.address],
				[new BN(21).mul(oneEth).div(new BN(10)), new BN(21).mul(oneEth).div(new BN(10000))]
			);
			await lend_to_pool(loanToken, SUSD, owner);
		});

		// margin trading should succeed if the transfered amount does not exceed the transaction limit
		it("Test margin trading within limit", async () => {
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await set_transaction_limit(accounts[0], [SUSD.address, RBTC.address], [new BN(1000).mul(oneEth), oneEth]);
			await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, owner);
		});

		// borrowing should succeed if the transfered amount does not exceed the transaction limit
		it("Test borrowing trading within limit", async () => {
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await set_transaction_limit(accounts[0], [SUSD.address, RBTC.address], [new BN(1000).mul(oneEth), oneEth]);
			await borrow_indefinite_loan(loanToken, sovryn, SUSD, RBTC, accounts);
		});

		// lending should succeed if the transfered amount does not exceed the transaction limit
		it("Test lending within limit", async () => {
			await set_transaction_limit(accounts[0], [SUSD.address, RBTC.address], [new BN(10).pow(new BN(30)), oneEth]);
			await lend_to_pool(loanToken, SUSD, owner);
		});
	});
});
