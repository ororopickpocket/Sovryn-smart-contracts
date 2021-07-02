const { constants, BN, expectRevert } = require("@openzeppelin/test-helpers");
const { expect } = require("chai");
const { decodeLogs, verify_sov_reward_payment } = require("../Utils/initializer");
const { blockNumber, increaseTime } = require("../Utils/Ethereum");
const LoanOpenings = artifacts.require("LoanOpenings");
const SwapsEvents = artifacts.require("SwapsEvents");
const LoanClosingsEvents = artifacts.require("LoanClosingsEvents");

const wei = web3.utils.toWei;
const oneEth = new BN(wei("1", "ether"));
const hunEth = new BN(wei("100", "ether"));
const BN2 = new BN(2);

/*
makes a margin trade sending loan tokens as collateral. therefore, not just the loan, but the complete position needs to be swapped.
process:
1. approve the transfer
2. send the margin trade tx
3. verify the trade event and balances are correct
4. retrieve the loan from the smart contract and make sure all values are set as expected
*/
const margin_trading_sending_loan_tokens = async (accounts, sovryn, loanToken, underlyingToken, collateralToken, priceFeeds, sendValue) => {
	// preparation
	const loan_token_sent = oneEth;
	await underlyingToken.mint(loanToken.address, loan_token_sent.mul(new BN(3)));
	await underlyingToken.mint(accounts[0], loan_token_sent);
	await underlyingToken.approve(loanToken.address, loan_token_sent);
	const value = sendValue ? loan_token_sent : 0;

	// send the transaction
	const leverage_amount = oneEth.mul(new BN(2));
	const collateral_sent = new BN(0);
	const { receipt } = await loanToken.marginTrade(
		constants.ZERO_BYTES32, //loanId  (0 for new loans)
		leverage_amount.toString(), // leverageAmount
		loan_token_sent.toString(), // loanTokenSent
		collateral_sent.toString(), // no collateral token sent
		collateralToken.address, // collateralTokenAddress
		accounts[0], // trader,
		0,
		"0x", // loanDataBytes (only required with ether)
		{ value: value }
	);

	// check the balances and the trade event
	const sovryn_after_collateral_token_balance = await collateralToken.balanceOf(sovryn.address);
	const loantoken_after_underlying_token_balance = await underlyingToken.balanceOf(loanToken.address);
	const decode = decodeLogs(receipt.rawLogs, LoanOpenings, "Trade");
	const args = decode[0].args;
	expect(args["borrowedAmount"]).to.equal(loan_token_sent.mul(new BN(2)).toString());
	expect(args["positionSize"]).to.equal(sovryn_after_collateral_token_balance.toString());
	expect(loan_token_sent.mul(new BN(3)).sub(new BN(args["borrowedAmount"]))).to.be.a.bignumber.eq(
		loantoken_after_underlying_token_balance
	);

	// compute the expected values of the loan object
	const start_margin = new BN(10).pow(new BN(38)).div(leverage_amount);
	const total_deposit = loan_token_sent.add(collateral_sent);
	const { rate: trade_rate, precision: trade_rate_precision } = await priceFeeds.queryRate(
		underlyingToken.address,
		collateralToken.address
	);
	const { rate: collateral_to_loan_rate, precision: collateral_to_loan_precision } = await priceFeeds.queryRate(
		collateralToken.address,
		underlyingToken.address
	);

	const collateral_to_loan_swap_rate = collateral_to_loan_precision.mul(trade_rate_precision).div(new BN(args["entryPrice"]));
	const interest_rate = await loanToken.nextBorrowInterestRate(total_deposit.mul(hunEth).div(start_margin));
	const principal = loan_token_sent.mul(BN2);
	const seconds_per_day = new BN(24 * 60 * 60);
	const max_loan_duration = seconds_per_day.mul(new BN(28));
	const seconds_per_year = seconds_per_day.mul(new BN(365));
	const borrow_amount = total_deposit
		.mul(new BN(10).pow(new BN(40)))
		.div(interest_rate.div(seconds_per_year).mul(max_loan_duration).div(start_margin).mul(hunEth).add(hunEth))
		.div(start_margin);
	const owed_per_day = borrow_amount.mul(interest_rate).div(new BN(365).mul(hunEth));
	const interest_amount_required = new BN(28).mul(owed_per_day).div(seconds_per_day);
	const trading_fee = loan_token_sent
		.add(borrow_amount)
		.mul(new BN(15).mul(new BN(10).pow(new BN(16))))
		.div(hunEth); // 0.15% fee
	const collateral = collateral_sent
		.add(loan_token_sent)
		.add(borrow_amount)
		.sub(interest_amount_required)
		.sub(trading_fee)
		.mul(trade_rate)
		.div(trade_rate_precision);
	//current_margin = (collateral * collateral_to_loan_rate / 1e18 - principal) / principal * 1e20
	const current_margin = collateral.mul(collateral_to_loan_rate).div(oneEth).sub(principal).mul(hunEth).div(principal);
	//TODO: problem: rounding error somewhere

	const loan_id = args["loanId"];
	const loan = await sovryn.getLoan(loan_id);
	const end_timestamp = loan["endTimestamp"];
	const num = await blockNumber();
	let currentBlock = await web3.eth.getBlock(num);
	const block_timestamp = currentBlock.timestamp;

	const interest_deposit_remaining =
		end_timestamp >= block_timestamp ? new BN(end_timestamp).sub(new BN(block_timestamp)).mul(owed_per_day).div(seconds_per_day) : 0;
	// assert the loan object is set as expected
	expect(loan["loanToken"]).to.equal(underlyingToken.address);
	expect(loan["collateralToken"]).to.equal(collateralToken.address);
	expect(loan["principal"]).to.equal(principal.toString());
	expect(loan["collateral"]).to.equal(collateral.toString());

	expect(loan["interestOwedPerDay"]).to.equal(owed_per_day.toString());
	expect(loan["interestDepositRemaining"]).to.eq(interest_deposit_remaining.toString());
	expect(loan["startRate"]).to.eq(collateral_to_loan_swap_rate.toString());
	expect(loan["startMargin"]).to.eq(start_margin.toString());
	expect(loan["maintenanceMargin"]).to.eq(new BN(15).mul(oneEth).toString());
	expect(loan["currentMargin"]).to.eq(current_margin.toString());
	expect(loan["maxLoanTerm"]).to.eq(max_loan_duration.toString()); // In the SC is hardcoded to 28 days
	expect(new BN(block_timestamp).add(max_loan_duration).sub(new BN(end_timestamp)).lt(new BN(1))).to.be.true;
	expect(loan["maxLiquidatable"]).to.eq("0");
	expect(loan["maxSeizable"]).to.eq("0");
};

const margin_trading_sov_reward_payment = async (accounts, loanToken, underlyingToken, collateralToken, SOV, FeesEvents) => {
	// preparation
	const loan_token_sent = oneEth;
	await underlyingToken.mint(loanToken.address, loan_token_sent.mul(new BN(3)));
	const trader = accounts[0];
	await underlyingToken.mint(trader, loan_token_sent);
	await underlyingToken.approve(loanToken.address, loan_token_sent);

	// send the transaction
	const leverage_amount = oneEth.mul(BN2);
	const collateral_sent = new BN(0);
	const sov_initial_balance = await SOV.balanceOf(trader);

	const { receipt } = await loanToken.marginTrade(
		constants.ZERO_BYTES32, // loanId  (0 for new loans)
		leverage_amount.toString(), // leverageAmount
		loan_token_sent.toString(), // loanTokenSent
		collateral_sent.toString(), // no collateral token sent
		collateralToken.address, // collateralTokenAddress
		trader, // trader,
		0,
		"0x" // loanDataBytes (only required with ether)
	);

	await increaseTime(10 * 24 * 60 * 60);

	const loan_id = constants.ZERO_BYTES32; // is zero because is a new loan
	await verify_sov_reward_payment(receipt.rawLogs, FeesEvents, SOV, trader, loan_id, sov_initial_balance, 1);
};

/*
makes a margin trade sending collateral tokens as collateral. therefore, only the loan needs to be swapped.
process:
1. send the margin trade tx with the passed parameter (NOTE: the token transfer needs to be approved already)
2. TODO verify the trade event and balances are correct
*/
const margin_trading_sending_collateral_tokens = async (
	accounts,
	loanToken,
	underlyingToken,
	collateralToken,
	loanSize,
	collateralTokenSent,
	leverageAmount,
	value,
	priceFeeds
) => {
	await get_estimated_margin_details(loanToken, collateralToken, loanSize, collateralTokenSent, leverageAmount);

	const { rate } = await priceFeeds.queryRate(underlyingToken.address, collateralToken.address);
	const { receipt } = await loanToken.marginTrade(
		constants.ZERO_BYTES32, //loanId  (0 for new loans)
		leverageAmount, // leverageAmount
		0,
		collateralTokenSent,
		collateralToken.address,
		accounts[0],
		0,
		"0x",
		{ value: value }
	);

	const decode = decodeLogs(receipt.rawLogs, LoanOpenings, "Trade");
	const args = decode[0].args;

	expect(args["positionSize"]).to.eq(
		new BN(args["borrowedAmount"]).mul(new BN(args["entryPrice"]) /*.addn(1)*/).div(oneEth).add(collateralTokenSent).toString()
	); //addn(1) - rounding error if used with p3.9 from bzx peckshield-audit-report-bZxV2-v1.0rc1.pdf; cannot be applied solely as it drives to some other tests failure

	expect(args["borrowedAmount"]).to.eq(
		loanSize
			.mul(collateralTokenSent)
			.mul(leverageAmount)
			.div(new BN(10).pow(new BN(36)))
			.toString()
	);
	expect(args["interestRate"]).to.eq("0");
	expect(args["entryPrice"]).to.eq(
		rate
			.mul(new BN(9985))
			.div(new BN(10000)) /*.sub(new BN(1))*/
			.toString()
	); //9985 == (1-0.15/100); sub(1) - rounding error // p3.9 from bzx peckshield-audit-report-bZxV2-v1.0rc1.pdf; cannot be applied solely as it drives to some other tests failure
	expect(args["entryLeverage"]).to.eq(leverageAmount.toString());
};

const margin_trading_sending_collateral_tokens_sov_reward_payment = async (
	trader,
	loanToken,
	collateralToken,
	collateralTokenSent,
	leverageAmount,
	value,
	FeesEvents,
	SOV
) => {
	const sov_initial_balance = await SOV.balanceOf(trader);
	const { receipt } = await loanToken.marginTrade(
		constants.ZERO_BYTES32,
		leverageAmount,
		0,
		collateralTokenSent,
		collateralToken.address,
		trader,
		0,
		"0x",
		{
			from: trader,
			value: value,
		}
	);

	await increaseTime(10 * 24 * 60 * 60);

	const loan_id = constants.ZERO_BYTES32; // is zero because is a new loan
	verify_sov_reward_payment(receipt.rawLogs, FeesEvents, SOV, trader, loan_id, sov_initial_balance, 1);
};

/*
close a position completely.
1. prepares the test by setting up the interest rates, lending to the pool and opening a position
2. travels in time, so interest needs to be paid
3. makes sure closing with an unauthorized caller fails (only the trader may close his position)
4. sends the closing tx from the trader
5. verifies the result
*/
const close_complete_margin_trade = async (
	sovryn,
	loanToken,
	set_demand_curve,
	lend_to_pool,
	open_margin_trade_position,
	priceFeeds,
	return_token_is_collateral,
	RBTC,
	WRBTC,
	SUSD,
	accounts
) => {
	// prepare the test
	await set_demand_curve(loanToken);
	await lend_to_pool(loanToken, SUSD, accounts[0]);
	const [loan_id, trader, loan_token_sent] = await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, accounts[1]);

	await increaseTime(10 * 24 * 60 * 60);
	const initial_loan = await sovryn.getLoan(loan_id);

	// needs to be called by the trader
	expectRevert(sovryn.closeWithSwap(loan_id, trader, loan_token_sent, return_token_is_collateral, "0x"), "unauthorized");

	// complete closure means the whole collateral is swapped
	const swap_amount = initial_loan["collateral"];

	await internal_test_close_margin_trade(
		new BN(swap_amount),
		initial_loan,
		loanToken,
		loan_id,
		priceFeeds,
		sovryn,
		trader,
		return_token_is_collateral
	);
};

const close_complete_margin_trade_wrbtc = async (
	sovryn,
	loanToken,
	loanTokenWRBTC,
	set_demand_curve,
	lend_to_pool_iBTC,
	open_margin_trade_position_iBTC,
	priceFeeds,
	return_token_is_collateral,
	RBTC,
	WRBTC,
	SUSD,
	accounts
) => {
	// prepare the test
	await set_demand_curve(loanToken);
	await lend_to_pool_iBTC(loanTokenWRBTC, accounts[0]);
	const [loan_id, trader, loan_token_sent] = await open_margin_trade_position_iBTC(loanTokenWRBTC, SUSD, accounts[1]);

	await increaseTime(10 * 24 * 60 * 60);
	const initial_loan = await sovryn.getLoan(loan_id);

	// needs to be called by the trader
	expectRevert(sovryn.closeWithSwap(loan_id, trader, loan_token_sent, return_token_is_collateral, "0x"), "unauthorized");

	// complete closure means the whole collateral is swapped
	const swap_amount = initial_loan["collateral"];

	await internal_test_close_margin_trade(
		new BN(swap_amount),
		initial_loan,
		loanTokenWRBTC,
		loan_id,
		priceFeeds,
		sovryn,
		trader,
		return_token_is_collateral
	);
};
const close_complete_margin_trade_sov_reward_payment = async (
	sovryn,
	set_demand_curve,
	lend_to_pool,
	open_margin_trade_position,
	return_token_is_collateral,
	FeesEvents,
	loanToken,
	RBTC,
	WRBTC,
	SUSD,
	SOV,
	accounts
) => {
	// prepare the test
	await set_demand_curve(loanToken);
	await lend_to_pool(loanToken, SUSD, accounts[0]);
	const [loan_id, trader, loan_token_sent] = await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, accounts[1]);

	await increaseTime(10 * 24 * 60 * 60);
	const initial_loan = await sovryn.getLoan(loan_id);

	// needs to be called by the trader
	expectRevert(sovryn.closeWithSwap(loan_id, trader, loan_token_sent, return_token_is_collateral, "0x"), "unauthorized");

	// complete closure means the whole collateral is swapped
	const swap_amount = initial_loan["collateral"];

	const sov_initial_balance = await SOV.balanceOf(trader);
	const { receipt } = await sovryn.closeWithSwap(loan_id, trader, swap_amount, return_token_is_collateral, "0x", { from: trader });
	await verify_sov_reward_payment(receipt.rawLogs, FeesEvents, SOV, trader, loan_id, sov_initial_balance, 2);
};

/*
close a position partially
1. prepares the test by setting up the interest rates, lending to the pool and opening a position
2. travels in time, so interest needs to be paid
3. makes sure closing with an unauthorized caller fails (only the trader may close his position)
4. sends the closing tx from the trader
5. verifies the result
*/
const close_partial_margin_trade = async (
	sovryn,
	loanToken,
	set_demand_curve,
	lend_to_pool,
	open_margin_trade_position,
	priceFeeds,
	return_token_is_collateral,
	RBTC,
	WRBTC,
	SUSD,
	accounts
) => {
	// prepare the test
	await set_demand_curve(loanToken);
	await lend_to_pool(loanToken, SUSD, accounts[0]);
	const [loan_id, trader, loan_token_sent] = await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, accounts[1]);

	await increaseTime(10 * 24 * 60 * 60);
	const initial_loan = await sovryn.getLoan(loan_id);

	// needs to be called by the trader
	expectRevert(sovryn.closeWithSwap(loan_id, trader, loan_token_sent, return_token_is_collateral, "0x"), "unauthorized");

	const swap_amount = new BN(initial_loan["collateral"]).mul(new BN(80).mul(oneEth)).div(hunEth);

	await internal_test_close_margin_trade(
		new BN(swap_amount),
		initial_loan,
		loanToken,
		loan_id,
		priceFeeds,
		sovryn,
		trader,
		return_token_is_collateral
	);
};

const close_partial_margin_trade_sov_reward_payment = async (
	sovryn,
	set_demand_curve,
	lend_to_pool,
	open_margin_trade_position,
	return_token_is_collateral,
	FeesEvents,
	loanToken,
	RBTC,
	WRBTC,
	SUSD,
	SOV,
	accounts
) => {
	// prepare the test
	await set_demand_curve(loanToken);
	await lend_to_pool(loanToken, SUSD, accounts[0]);
	const [loan_id, trader] = await open_margin_trade_position(loanToken, RBTC, WRBTC, SUSD, accounts[1]);

	await increaseTime(10 * 24 * 60 * 60);
	const initial_loan = await sovryn.getLoan(loan_id);

	const swap_amount = new BN(initial_loan["collateral"]).mul(new BN(80).mul(oneEth)).div(hunEth);

	const sov_initial_balance = await SOV.balanceOf(trader);
	const { receipt } = await sovryn.closeWithSwap(loan_id, trader, swap_amount, return_token_is_collateral, "0x", { from: trader });
	await verify_sov_reward_payment(receipt.rawLogs, FeesEvents, SOV, trader, loan_id, sov_initial_balance, 2);
};

const internal_test_close_margin_trade = async (
	swap_amount,
	initial_loan,
	loanToken,
	loan_id,
	priceFeeds,
	sovryn,
	trader,
	return_token_is_collateral
) => {
	const principal_ = new BN(initial_loan["principal"]);
	const collateral_ = new BN(initial_loan["collateral"]);

	const { receipt } = await sovryn.closeWithSwap(loan_id, trader, swap_amount, return_token_is_collateral, "0x", { from: trader });
	const closed_loan = await sovryn.getLoan(loan_id);
	const loan_token_ = initial_loan["loanToken"];
	const collateral_token_ = initial_loan["collateralToken"];
	const { rate: trade_rate, precision } = await priceFeeds.queryRate(collateral_token_, loan_token_);

	swap_amount = swap_amount.gt(collateral_) ? collateral_ : swap_amount;

	let loan_close_amount = swap_amount.eq(collateral_)
		? principal_
		: return_token_is_collateral
		? principal_.mul(swap_amount).div(collateral_)
		: new BN(0);

	const interest_refund_to_borrower = new BN(initial_loan["interestDepositRemaining"]).mul(loan_close_amount).div(principal_);

	const loan_close_amount_less_interest =
		!loan_close_amount.eq(new BN(0)) && loan_close_amount.gte(interest_refund_to_borrower)
			? loan_close_amount.sub(interest_refund_to_borrower)
			: interest_refund_to_borrower;

	const trading_fee_percent = await sovryn.tradingFeePercent();
	const aux_trading_fee = return_token_is_collateral ? loan_close_amount_less_interest : swap_amount;
	const trading_fee = aux_trading_fee.mul(trading_fee_percent).div(hunEth);

	const source_token_amount_used = return_token_is_collateral
		? loan_close_amount_less_interest.add(trading_fee).mul(precision).div(trade_rate)
		: swap_amount;

	const dest_token_amount_received = return_token_is_collateral
		? loan_close_amount_less_interest
		: swap_amount.sub(trading_fee).mul(trade_rate).div(precision);

	let collateral_to_loan_swap_rate = dest_token_amount_received.mul(precision).div(source_token_amount_used);
	// 1e36 produces a wrong number because of floating point
	collateral_to_loan_swap_rate = new BN(10).pow(new BN(36)).div(collateral_to_loan_swap_rate);

	const source_token_amount_used_2 = dest_token_amount_received.gte(principal_) ? collateral_ : source_token_amount_used;
	const used_collateral = source_token_amount_used_2.gt(swap_amount) ? source_token_amount_used_2 : swap_amount;

	const covered_principal =
		swap_amount.eq(collateral_) || return_token_is_collateral
			? loan_close_amount_less_interest
			: dest_token_amount_received.gte(principal_)
			? principal_
			: dest_token_amount_received;

	loan_close_amount = loan_close_amount.eq(new BN(0)) ? covered_principal : loan_close_amount;

	const new_collateral = !used_collateral.eq(new BN(0)) ? collateral_.sub(used_collateral) : collateral_;
	const new_principal = loan_close_amount.eq(principal_) ? new BN(0) : principal_.sub(loan_close_amount);

	let current_margin = new_collateral.mul(trade_rate).mul(oneEth).div(precision).div(oneEth);
	current_margin =
		!new_principal.eq(new BN(0)) && current_margin.gte(new_principal)
			? current_margin.sub(new_principal).mul(hunEth).div(new_principal)
			: new BN(0);
	current_margin = !current_margin.eq(new BN(0)) ? new BN(10).pow(new BN(38)).div(current_margin) : new BN(0);

	const decode = decodeLogs(receipt.rawLogs, SwapsEvents, "LoanSwap");
	const args = decode[0].args;

	expect(args["loanId"] == loan_id).to.be.true;
	expect(args["sourceToken"]).to.equal(collateral_token_.toString());
	expect(args["destToken"] == loan_token_).to.be.true;
	expect(args["borrower"] == trader).to.be.true;

	// 10000 is the source buffer used by the sovryn swap connector
	// expect(new BN(args["sourceAmount"]).sub(source_token_amount_used).lte(new BN(10000))).to.be.true;
	expect(new BN(args["destAmount"]).gte(dest_token_amount_received.mul(new BN(995)).div(new BN(1000)))).to.be.true;

	const decode2 = decodeLogs(receipt.rawLogs, LoanClosingsEvents, "CloseWithSwap");
	const args2 = decode2[0].args;

	expect(args2["loanId"] == loan_id).to.be.true;
	expect(args2["loanCloseAmount"]).to.eq(loan_close_amount.toString());
	expect(args2["currentLeverage"]).to.eq(current_margin.toString());
	expect(args2["closer"] == trader).to.be.true;
	expect(args2["user"] == trader).to.be.true;
	expect(args2["lender"] == loanToken.address).to.be.true;
	expect(args2["collateralToken"] == collateral_token_).to.be.true;
	expect(args2["loanToken"] == loan_token_).to.be.true;
	expect(args2["positionCloseSize"]).to.eq(used_collateral.toString());
	expect(new BN(args2["exitPrice"]).sub(collateral_to_loan_swap_rate).mul(new BN(100)).div(collateral_to_loan_swap_rate).eq(new BN(0))).to
		.be.true;

	expect(closed_loan["principal"] == new_principal.toString()).to.be.true;
	if (loan_close_amount.eq(principal_)) {
		const last_block_timestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber()))["timestamp"];
		expect(closed_loan["endTimestamp"] <= last_block_timestamp).to.be.true;
	}
};

const get_estimated_margin_details = async (loanToken, collateralToken, loanSize, collateralTokenSent, leverageAmount) => {
	// leverageAmount, loanTokenSent, collateralTokenSent, collateralTokenAddress
	const result = await loanToken.getEstimatedMarginDetails(leverageAmount, 0, collateralTokenSent, collateralToken.address);
	//"2003004506760140211"; collateralTokenSent
	//"5000000000000000000"; leverageAmount
	//"20000000000000000000000"; loanSize
	//"100150225338007010550000"; result[0]

	expect(result[0]).to.be.a.bignumber.eq(
		loanSize
			.mul(collateralTokenSent)
			.mul(leverageAmount)
			.div(new BN(10).pow(new BN(36)))
	);
	expect(result[2].eq(new BN(0))).to.be.true;
};

module.exports = {
	margin_trading_sending_loan_tokens,
	margin_trading_sov_reward_payment,
	margin_trading_sending_collateral_tokens,
	margin_trading_sending_collateral_tokens_sov_reward_payment,
	close_complete_margin_trade,
	close_complete_margin_trade_sov_reward_payment,
	close_partial_margin_trade,
	close_partial_margin_trade_sov_reward_payment,
	close_complete_margin_trade_wrbtc,
};
