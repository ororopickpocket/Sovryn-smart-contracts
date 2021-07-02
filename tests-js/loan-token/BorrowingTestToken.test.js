const { expect } = require("chai");
const { expectRevert, BN, expectEvent } = require("@openzeppelin/test-helpers");
const FeesEvents = artifacts.require("FeesEvents");
const TestToken = artifacts.require("TestToken");
const LoanOpenings = artifacts.require("LoanOpenings");

const {
	getSUSD,
	getRBTC,
	getWRBTC,
	getBZRX,
	getSOV,
	getLoanTokenLogic,
	getLoanToken,
	getLoanTokenWRBTC,
	loan_pool_setup,
	set_demand_curve,
	lend_to_pool,
	getPriceFeeds,
	getSovryn,
	decodeLogs,
	verify_sov_reward_payment,
	CONSTANTS,
} = require("../Utils/initializer.js");

const wei = web3.utils.toWei;

const oneEth = new BN(wei("1", "ether"));
const tenEth = new BN(wei("10", "ether"));
const hunEth = new BN(wei("100", "ether"));

// This decodes longs for a single event type, and returns a decoded object in
// the same form truffle-contract uses on its receipts

contract("LoanTokenBorrowing", (accounts) => {
	let owner, account1;
	let sovryn, SUSD, WRBTC, RBTC, BZRX, loanToken, loanTokenWRBTC, SOV;

	before(async () => {
		[owner, account1] = accounts;
	});

	beforeEach(async () => {
		SUSD = await getSUSD();
		RBTC = await getRBTC();
		WRBTC = await getWRBTC();
		BZRX = await getBZRX();
		const priceFeeds = await getPriceFeeds(WRBTC, SUSD, RBTC, sovryn, BZRX);

		sovryn = await getSovryn(WRBTC, SUSD, RBTC, priceFeeds);

		const loanTokenLogicStandard = await getLoanTokenLogic();
		loanToken = await getLoanToken(loanTokenLogicStandard, owner, sovryn, WRBTC, SUSD);
		loanTokenWRBTC = await getLoanTokenWRBTC(loanTokenLogicStandard, owner, sovryn, WRBTC, SUSD);
		await loan_pool_setup(sovryn, owner, RBTC, WRBTC, SUSD, loanToken, loanTokenWRBTC);

		SOV = await getSOV(sovryn, priceFeeds, SUSD);
	});

	describe("Test borrow", () => {
		it("Test borrow", async () => {
			// prepare the test
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			// determine borrowing parameter
			const withdrawAmount = tenEth;
			// compute the required collateral. params: address loanToken, address collateralToken, uint256 newPrincipal,uint256 marginAmount, bool isTorqueLoan
			const collateralTokenSent = await sovryn.getRequiredCollateral(
				SUSD.address,
				RBTC.address,
				withdrawAmount,
				new BN(10).pow(new BN(18)).mul(new BN(50)),
				true
			);
			const durationInSeconds = 60 * 60 * 24 * 10; // 10 days
			// compute expected values for asserts
			const interestRate = await loanToken.nextBorrowInterestRate(withdrawAmount);
			// principal = withdrawAmount/(1 - interestRate/1e20 * durationInSeconds /  31536000)
			const principal = withdrawAmount
				.mul(oneEth)
				.div(oneEth.sub(interestRate.mul(new BN(durationInSeconds)).mul(oneEth).div(new BN(31536000)).div(hunEth)));
			//TODO: refactor formula to remove rounding error subn(1)
			const borrowingFee = (await sovryn.borrowingFeePercent()).mul(collateralTokenSent).div(hunEth); /*.addn(1)*/
			const expectedBalance = (await SUSD.balanceOf(account1)).add(withdrawAmount);
			// approve the transfer of the collateral
			await RBTC.approve(loanToken.address, collateralTokenSent);
			const sov_initial_balance = await SOV.balanceOf(owner);

			// borrow some funds
			const { tx, receipt } = await loanToken.borrow(
				"0x0", // bytes32 loanId
				withdrawAmount, // uint256 withdrawAmount
				durationInSeconds, // uint256 initialLoanDuration
				collateralTokenSent, // uint256 collateralTokenSent
				RBTC.address, // address collateralTokenAddress
				owner, // address borrower
				account1, // address receiver
				web3.utils.fromAscii("") // bytes memory loanDataBytes
			);
			// assert the trade was processed as expected
			await expectEvent.inTransaction(tx, LoanOpenings, "Borrow", {
				user: owner,
				lender: loanToken.address,
				loanToken: SUSD.address,
				collateralToken: RBTC.address,
				newPrincipal: principal,
				newCollateral: collateralTokenSent.sub(borrowingFee),
				interestRate: interestRate,
			});
			const decode = decodeLogs(receipt.rawLogs, LoanOpenings, "Borrow");
			const args = decode[0].args;

			expect(args["interestDuration"] >= durationInSeconds - 1 && args["interestDuration"] <= durationInSeconds).to.be.true;
			expect(new BN(args["currentMargin"])).to.be.a.bignumber.gt(new BN(49).mul(oneEth));

			// assert the user received the borrowed amount
			expect(await SUSD.balanceOf(account1)).to.be.a.bignumber.equal(expectedBalance);
			await verify_sov_reward_payment(receipt.rawLogs, FeesEvents, SOV, owner, args["loanId"], sov_initial_balance, 1);
		});

		it("Test borrow 0 collateral should fail", async () => {
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await expectRevert(
				loanToken.borrow(
					"0x0", // bytes32 loanId
					10, // uint256 withdrawAmount
					24 * 60 * 60, // uint256 initialLoanDuration
					0, // uint256 collateralTokenSent
					RBTC.address, // address collateralTokenAddress
					owner, // address borrower
					account1, // address receiver
					"0x0" // bytes memory loanDataBytes
				),
				"7"
			);
		});

		it("Test borrow 0 withdraw should fail", async () => {
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			expectRevert(
				loanToken.borrow(
					"0x0", // bytes32 loanId
					0, // uint256 withdrawAmount
					24 * 60 * 60, // uint256 initialLoanDuration
					10, // uint256 collateralTokenSent
					RBTC.address, // address collateralTokenAddress
					owner, // address borrower
					account1, // address receiver
					"0x0" // bytes memory loanDataBytes
				),
				"6"
			);
		});

		it("Test borrow sending value with tokens should fail", async () => {
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			expectRevert(
				loanToken.borrow(
					"0x0", // bytes32 loanId
					10, // uint256 withdrawAmount
					24 * 60 * 60, // uint256 initialLoanDuration
					10, // uint256 collateralTokenSent
					RBTC.address, // address collateralTokenAddress
					owner, // address borrower
					account1, // address receiver
					"0x0", // bytes memory loanDataBytes
					{ value: 100 }
				),
				"7"
			);
		});

		it("Test borrow invalid collateral should fail", async () => {
			await set_demand_curve(loanToken);
			await lend_to_pool(loanToken, SUSD, owner);
			await expectRevert(
				loanToken.borrow(
					"0x0", // bytes32 loanId
					10, // uint256 withdrawAmount
					24 * 60 * 60, // uint256 initialLoanDuration
					10, // uint256 collateralTokenSent
					CONSTANTS.ZERO_ADDRESS, // address collateralTokenAddress
					owner, // address borrower
					account1, // address receiver
					"0x0" // bytes memory loanDataBytes
				),
				"7"
			);

			expectRevert(
				loanToken.borrow(
					"0x0", // bytes32 loanId
					10, // uint256 withdrawAmount
					24 * 60 * 60, // uint256 initialLoanDuration
					10, // uint256 collateralTokenSent
					SUSD.address, // address collateralTokenAddress
					owner, // address borrower
					account1, // address receiver
					"0x0" // bytes memory loanDataBytes
				),
				"10"
			);
		});

		it("Test borrow no interest should fail", async () => {
			// no demand curve settings -> no interest set
			//  prepare the test
			await lend_to_pool(loanToken, SUSD, owner);

			// determine borrowing parameter
			const withdrawAmount = oneEth.mul(new BN(10)); // i want to borrow 10 USD
			// compute the required collateral. params: address loanToken, address collateralToken, uint256 newPrincipal,uint256 marginAmount, bool isTorqueLoan
			const collateralTokenSent = await sovryn.getRequiredCollateral(
				SUSD.address,
				RBTC.address,
				withdrawAmount,
				new BN(50).pow(new BN(18)),
				true
			);

			//approve the transfer of the collateral
			await RBTC.approve(loanToken.address, collateralTokenSent);
			expectRevert(
				loanToken.borrow(
					"0x0", // bytes32 loanId
					withdrawAmount, // uint256 withdrawAmount
					24 * 60 * 60, // uint256 initialLoanDuration
					collateralTokenSent, // uint256 collateralTokenSent
					RBTC.address, // address collateralTokenAddress
					owner, // address borrower
					account1, // address receiver
					"0x0" // bytes memory loanDataBytes
				),
				"invalid interest"
			);
		});

		it("Test borrow insufficient collateral should fail", async () => {
			//  prepare the test

			await lend_to_pool(loanToken, SUSD, owner);
			await set_demand_curve(loanToken);

			// determine borrowing parameter
			const withdrawAmount = oneEth.mul(new BN(10)); // i want to borrow 10 USD
			// compute the required collateral. params: address loanToken, address collateralToken, uint256 newPrincipal,uint256 marginAmount, bool isTorqueLoan
			let collateralTokenSent = await sovryn.getRequiredCollateral(
				SUSD.address,
				RBTC.address,
				withdrawAmount,
				new BN(10).pow(new BN(18)).mul(new BN(50)),
				true
			);
			collateralTokenSent = collateralTokenSent.div(new BN(2));

			//approve the transfer of the collateral
			await RBTC.approve(loanToken.address, collateralTokenSent);
			expectRevert(
				loanToken.borrow(
					"0x0", // bytes32 loanId
					withdrawAmount, // uint256 withdrawAmount
					24 * 60 * 60, // uint256 initialLoanDuration
					collateralTokenSent, // uint256 collateralTokenSent
					RBTC.address, // address collateralTokenAddress
					owner, // address borrower
					account1, // address receiver
					"0x0" // bytes memory loanDataBytes
				),
				"collateral insufficient"
			);
		});

		// borrows some funds from account 0 and then takes out some more from account 2 with 'borrow' without paying should fail.
		it("Test borrow from foreign loan should fail", async () => {
			//  prepare the test

			await lend_to_pool(loanToken, SUSD, owner);
			await set_demand_curve(loanToken);

			// determine borrowing parameter
			const withdrawAmount = oneEth.mul(new BN(10)); // i want to borrow 10 USD
			// compute the required collateral. params: address loanToken, address collateralToken, uint256 newPrincipal,uint256 marginAmount, bool isTorqueLoan
			let collateralTokenSent = await sovryn.getRequiredCollateral(
				SUSD.address,
				RBTC.address,
				withdrawAmount,
				new BN(10).pow(new BN(18)).mul(new BN(50)),
				true
			);
			collateralTokenSent = collateralTokenSent.mul(new BN(2));
			const durationInSeconds = 60 * 60 * 24 * 10;

			// approve the transfer of the collateral
			await RBTC.approve(loanToken.address, collateralTokenSent);
			const borrower = accounts[0];

			const { receipt } = await loanToken.borrow(
				"0x0", // bytes32 loanId
				withdrawAmount, // uint256 withdrawAmount
				durationInSeconds, // uint256 initialLoanDuration
				collateralTokenSent, // uint256 collateralTokenSent
				RBTC.address, // address collateralTokenAddress
				borrower, // address borrower
				account1, // address receiver
				"0x0" // bytes memory loanDataBytes
			);

			const decode = decodeLogs(receipt.rawLogs, LoanOpenings, "Borrow");
			const loanId = decode[0].args["loanId"];

			await RBTC.transfer(accounts[2], collateralTokenSent);
			// approve the transfer of the collateral
			await RBTC.approve(loanToken.address, collateralTokenSent, { from: accounts[2] });

			await expectRevert(
				loanToken.borrow(
					loanId, // bytes32 loanId
					withdrawAmount.div(new BN(2)), // uint256 withdrawAmount
					durationInSeconds, // uint256 initialLoanDuration
					1, // uint256 collateralTokenSent
					RBTC.address, // address collateralTokenAddress
					borrower, // address borrower
					accounts[2], // address receiver
					"0x0", // bytes memory loanDataBytes
					{ from: accounts[2] }
				),
				"7"
			);
		});

		// borrows some funds from account 0 and then takes out some more from account 2 with a marginTrade without paying should fail.
		it("Test margin trade from foreign loan should fail", async () => {
			//  prepare the test

			await lend_to_pool(loanToken, SUSD, owner);
			await set_demand_curve(loanToken);

			// determine borrowing parameter
			const withdrawAmount = oneEth.mul(new BN(10)); // i want to borrow 10 USD
			// compute the required collateral. params: address loanToken, address collateralToken, uint256 newPrincipal,uint256 marginAmount, bool isTorqueLoan
			let collateralTokenSent = await sovryn.getRequiredCollateral(
				SUSD.address,
				RBTC.address,
				withdrawAmount,
				new BN(10).pow(new BN(18)).mul(new BN(50)),
				true
			);
			collateralTokenSent = collateralTokenSent.mul(new BN(2));
			const durationInSeconds = 60 * 60 * 24 * 10;

			// approve the transfer of the collateral
			await RBTC.approve(loanToken.address, collateralTokenSent);
			const borrower = accounts[0];

			const { receipt } = await loanToken.borrow(
				"0x0", // bytes32 loanId
				withdrawAmount, // uint256 withdrawAmount
				durationInSeconds, // uint256 initialLoanDuration
				collateralTokenSent, // uint256 collateralTokenSent
				RBTC.address, // address collateralTokenAddress
				borrower, // address borrower
				account1, // address receiver
				web3.utils.fromAscii("") // bytes memory loanDataBytes
			);

			const decode = decodeLogs(receipt.rawLogs, LoanOpenings, "Borrow");
			const loanId = decode[0].args["loanId"];

			await SUSD.transfer(accounts[2], collateralTokenSent);
			// approve the transfer of the collateral
			await SUSD.approve(loanToken.address, collateralTokenSent, { from: accounts[2] });

			await expectRevert(
				loanToken.marginTrade(
					loanId, // bytes32 loanId
					oneEth, // uint256 withdrawAmount
					10000000, // uint256 collateralTokenSent
					0,
					RBTC.address, // address collateralTokenAddress
					accounts[2], // address receiver
					0,
					"0x0", // bytes memory loanDataBytes
					{ from: accounts[2] }
				),
				"borrower mismatch"
			);
		});

		// margin trades from account 0 and then borrows from same loan should fail.
		it("Test borrow from trade position should fail", async () => {
			//  prepare the test

			await lend_to_pool(loanToken, SUSD, owner);
			await set_demand_curve(loanToken);

			// determine borrowing parameter
			const withdrawAmount = oneEth.mul(new BN(10)); // i want to borrow 10 USD

			await SUSD.approve(loanToken.address, withdrawAmount);

			const { receipt } = await loanToken.marginTrade(
				"0x0", // bytes32 loanId
				oneEth, // uint256 withdrawAmount
				withdrawAmount, // uint256 collateralTokenSent
				0,
				RBTC.address, // address collateralTokenAddress
				accounts[0], // address receiver
				0,
				"0x" // bytes memory loanDataBytes
			);

			const decode = decodeLogs(receipt.rawLogs, LoanOpenings, "Trade");
			const loanId = decode[0].args["loanId"];

			// approve the transfer of the collateral
			await RBTC.approve(loanToken.address, withdrawAmount);

			await expectRevert(
				loanToken.borrow(
					loanId, // bytes32 loanId
					withdrawAmount.div(new BN(10)), // uint256 withdrawAmount
					60 * 60 * 24 * 10, // uint256 initialLoanDuration
					1, // uint256 collateralTokenSent
					RBTC.address, // address collateralTokenAddress
					accounts[0], // address borrower
					accounts[0], // address receiver
					"0x" // bytes memory loanDataBytes
				),
				"loanParams mismatch"
			);
		});
	});
});
