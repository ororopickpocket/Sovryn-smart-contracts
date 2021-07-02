const { expectRevert, expectEvent, constants, BN } = require("@openzeppelin/test-helpers");
const { expect } = require("chai");
const { increaseTime } = require("../Utils/Ethereum");
const wei = web3.utils.toWei;
const oneEth = new BN(wei("1", "ether"));
const hunEth = new BN(wei("100", "ether"));

const verify_start_conditions = async (underlyingToken, loanToken, lender, initial_balance, deposit_amount) => {
	expect(initial_balance.eq(await underlyingToken.balanceOf(lender))).to.be.true;
	expect(new BN(0).eq(await loanToken.totalSupply())).to.be.true;
	expect(new BN(0).eq(await loanToken.profitOf(lender))).to.be.true;
	expect(new BN(0).eq(await loanToken.checkpointPrice(lender))).to.be.true;
	expect(new BN(0).eq(await loanToken.totalSupplyInterestRate(deposit_amount))).to.be.true;
};

const get_itoken_price = (assets_deposited, earned_interests, total_supply) => {
	return assets_deposited
		.add(earned_interests)
		.mul(new BN(wei("1", "ether")))
		.div(total_supply);
};

const lend_btc_before_cashout = async (loanToken, total_deposit_amount, lender) => {
	const initial_balance = new BN(await web3.eth.getBalance(lender));
	expect(initial_balance.gt(total_deposit_amount)).to.be.true;

	expect(await loanToken.checkpointPrice(lender)).to.be.a.bignumber.equal(new BN(0));
	await loanToken.mintWithBTC(lender, false, { value: total_deposit_amount });
	expect(await loanToken.checkpointPrice(lender)).to.be.a.bignumber.equal(await loanToken.initialPrice());

	const loan_token_initial_balance = total_deposit_amount.div(await loanToken.initialPrice()).mul(new BN(wei("1", "ether")));

	expect(await loanToken.balanceOf(lender)).to.be.a.bignumber.equal(loan_token_initial_balance);
	expect(await loanToken.totalSupply()).to.be.a.bignumber.equal(total_deposit_amount);

	return initial_balance;
};

const lend_tokens_before_cashout = async (loanToken, underlyingToken, total_deposit_amount, lender) => {
	const initial_balance = await underlyingToken.balanceOf(lender);
	expect(initial_balance.gt(total_deposit_amount)).to.be.true;

	await underlyingToken.approve(loanToken.address, total_deposit_amount);

	expect(await loanToken.checkpointPrice(lender)).to.be.a.bignumber.equal(new BN(0));
	await loanToken.mint(lender, total_deposit_amount);
	expect(await loanToken.checkpointPrice(lender)).to.be.a.bignumber.equal(await loanToken.initialPrice());
	const loan_token_initial_balance = total_deposit_amount.div(await loanToken.initialPrice()).mul(new BN(wei("1", "ether")));
	expect(await loanToken.balanceOf(lender)).to.be.a.bignumber.equal(loan_token_initial_balance);
	expect(await loanToken.totalSupply()).to.be.a.bignumber.equal(total_deposit_amount);

	return initial_balance;
};

const verify_lending_result_and_itoken_price_change = async (
	underlyingToken,
	collateralToken,
	loanToken,
	lender,
	loan_token_sent,
	deposit_amount,
	sovryn,
	sendValue = false
) => {
	// verify the result

	expect(await loanToken.balanceOf(lender)).to.be.a.bignumber.equal(deposit_amount.div(await loanToken.initialPrice()).mul(oneEth));
	const earned_interests_1 = new BN(0); // Shouldn't be earned interests
	const price1 = get_itoken_price(deposit_amount, earned_interests_1, await loanToken.totalSupply());
	expect(await loanToken.tokenPrice()).to.be.a.bignumber.equal(price1);
	expect(await loanToken.checkpointPrice(lender)).to.be.a.bignumber.equal(await loanToken.initialPrice());
	expect(await loanToken.totalSupplyInterestRate(deposit_amount)).to.be.a.bignumber.equal(new BN(0));

	// Should borrow money to get an interest rate different of zero (interest rate depends on the total borrowed amount)
	let value = sendValue ? loan_token_sent.toString() : "0";
	await loanToken.marginTrade(
		constants.ZERO_BYTES32, // loanId  (0 for new loans)
		new BN(2).pow(new BN(18)).toString(), // leverageAmount
		loan_token_sent.toString(), // loanTokenSent
		0, // no collateral token sent
		collateralToken.address, // collateralTokenAddress
		lender, // trader,
		0,
		"0x", // loanDataBytes (only required with ether),
		{
			value: value,
		}
	);

	// time travel for interest to accumulate
	await increaseTime(10000);

	// verify the token price changed according to the gained interest
	const price_2 = await loanToken.tokenPrice();
	const lender_interest_data = await sovryn.getLenderInterestData(loanToken.address, underlyingToken.address);
	const earned_interest_2 = new BN(lender_interest_data["interestUnPaid"])
		.mul(hunEth.sub(new BN(lender_interest_data["interestFeePercent"])))
		.div(hunEth);
	expect(price_2).to.be.a.bignumber.equal(get_itoken_price(deposit_amount, earned_interest_2, await loanToken.totalSupply()));
};

const lend_to_the_pool = async (loanToken, lender, underlyingToken, collateralToken, sovryn) => {
	const baseRate = wei("1", "ether");
	const rateMultiplier = wei("20.25", "ether");
	const targetLevel = wei("80", "ether");
	const kinkLevel = wei("90", "ether");
	const maxScaleRate = wei("100", "ether");

	await loanToken.setDemandCurve(baseRate, rateMultiplier, baseRate, rateMultiplier, targetLevel, kinkLevel, maxScaleRate);

	borrow_interest_rate = await loanToken.borrowInterestRate();
	expect(borrow_interest_rate.gt(baseRate)).to.be.true;

	const deposit_amount = new BN(wei("400", "ether"));
	const loan_token_sent = new BN(wei("100", "ether"));
	const total_deposit_amount = deposit_amount.add(loan_token_sent);
	const initial_balance = await underlyingToken.balanceOf(lender);

	await underlyingToken.approve(loanToken.address, total_deposit_amount.toString());

	await verify_start_conditions(underlyingToken, loanToken, lender, initial_balance, deposit_amount);
	await loanToken.mint(lender, deposit_amount);

	expect(await underlyingToken.balanceOf(lender)).to.be.a.bignumber.equal(initial_balance.sub(deposit_amount));

	await verify_lending_result_and_itoken_price_change(
		underlyingToken,
		collateralToken,
		loanToken,
		lender,
		loan_token_sent,
		deposit_amount,
		sovryn
	);
};

const cash_out_from_the_pool = async (loanToken, lender, underlyingToken, lendBTC) => {
	const amount_withdrawn = new BN(wei("100", "ether"));
	const total_deposit_amount = amount_withdrawn.mul(new BN(2));
	let initial_balance, balance_after_lending;
	if (lendBTC) {
		initial_balance = await lend_btc_before_cashout(loanToken, total_deposit_amount, lender);
		balance_after_lending = new BN(await web3.eth.getBalance(lender));
		await loanToken.burnToBTC(lender, amount_withdrawn.toString(), false);
	} else {
		initial_balance = await lend_tokens_before_cashout(loanToken, underlyingToken, total_deposit_amount, lender);
		await loanToken.burn(lender, amount_withdrawn.toString());
	}

	expect(await loanToken.checkpointPrice(lender)).to.be.a.bignumber.equal(await loanToken.initialPrice());

	expect(await loanToken.totalSupply()).to.be.a.bignumber.equal(amount_withdrawn);
	expect(await loanToken.tokenPrice()).to.be.a.bignumber.equal(
		get_itoken_price(amount_withdrawn, new BN(0), await loanToken.totalSupply())
	);
	expect(await loanToken.balanceOf(lender)).to.be.a.bignumber.equal(amount_withdrawn);
	if (lendBTC) {
		expect(new BN(await web3.eth.getBalance(lender)).gt(balance_after_lending)).to.be.true;
		expect(
			new BN(await web3.eth.getBalance(lender)).lt(
				initial_balance.sub(amount_withdrawn.mul(await loanToken.tokenPrice()).div(oneEth))
			)
		).to.be.true;
	} else {
		expect(await underlyingToken.balanceOf(lender)).to.be.a.bignumber.equal(
			initial_balance.sub(amount_withdrawn.mul(await loanToken.tokenPrice()).div(oneEth))
		);
	}
};

/*
//
const cash_out_from_the_pool_more_of_lender_balance_should_not_fail = async (loanToken, lender, underlyingToken) => {
	const initial_balance = await underlyingToken.balanceOf(lender);
	const amount_withdrawn = new BN(wei("100", "ether"));
	const total_deposit_amount = amount_withdrawn.mul(new BN(2));

	expect(initial_balance.gt(total_deposit_amount)).to.be.true;

	await underlyingToken.approve(loanToken.address, total_deposit_amount.toString());
	await loanToken.mint(lender, total_deposit_amount.toString());
	await loanToken.burn(lender, total_deposit_amount.mul(new BN(2)).toString());

	expect(await loanToken.balanceOf(lender)).to.be.a.bignumber.equal(new BN(0));
	expect(await loanToken.tokenPrice()).to.be.a.bignumber.equal(await loanToken.initialPrice());
	expect(await underlyingToken.balanceOf(lender)).to.be.a.bignumber.equal(initial_balance);
};*/

const cash_out_from_the_pool_uint256_max_should_withdraw_total_balance = async (loanToken, lender, underlyingToken) => {
	const initial_balance = await underlyingToken.balanceOf(lender);
	const amount_withdrawn = new BN(wei("100", "ether"));
	const total_deposit_amount = amount_withdrawn.mul(new BN(2));

	expect(initial_balance.gt(total_deposit_amount)).to.be.true;

	await underlyingToken.approve(loanToken.address, total_deposit_amount.toString());
	await loanToken.mint(lender, total_deposit_amount.toString());
	await expectRevert(loanToken.burn(lender, total_deposit_amount.mul(new BN(2))), "32");
	await loanToken.burn(lender, constants.MAX_UINT256);

	expect(await loanToken.balanceOf(lender)).to.be.a.bignumber.equal(new BN(0));
	expect(await loanToken.tokenPrice()).to.be.a.bignumber.equal(await loanToken.initialPrice());
	expect(await underlyingToken.balanceOf(lender)).to.be.a.bignumber.equal(initial_balance);
};

module.exports = {
	verify_start_conditions,
	get_itoken_price,
	lend_btc_before_cashout,
	lend_tokens_before_cashout,
	verify_lending_result_and_itoken_price_change,
	lend_to_the_pool,
	cash_out_from_the_pool,
	//cash_out_from_the_pool_more_of_lender_balance_should_not_fail,
	cash_out_from_the_pool_uint256_max_should_withdraw_total_balance,
};
